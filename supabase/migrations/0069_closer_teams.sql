-- Closer -> sales-agent hierarchy.
--
-- Company structure: closers (members of the Closing department) each own a
-- team of sales agents. A closer may see their team's work and act on it, and
-- every such action is recorded against the CLOSER so it is always clear who
-- actually did it.
--
-- Two rules from the operator, both enforced HERE rather than only in the app,
-- because a broken hierarchy silently changes who can see whose leads:
--   * a sales agent belongs to at most ONE closer  -> agent_id is the PK;
--   * a closer is never under another closer       -> trigger guard below.

create table if not exists public.closer_assignments (
  agent_id uuid primary key references public.profiles(id) on delete cascade,
  closer_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint closer_assignment_not_self check (agent_id <> closer_id)
);

create index if not exists closer_assignments_closer_idx
  on public.closer_assignments (closer_id);

comment on table public.closer_assignments is
  'Which closer owns which sales agent. One row per agent (the PK) — an agent has at most one closer.';

-- Membership guard. SECURITY DEFINER so it can read department_members
-- regardless of the caller's RLS, and pinned search_path per the same
-- convention as is_admin() in migration 0001.
create or replace function public.closer_assignment_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  closing_id uuid;
begin
  select id into closing_id from public.departments where slug = 'closing';
  if closing_id is null then
    raise exception 'There is no Closing department to assign closers from';
  end if;

  if not exists (
    select 1 from public.department_members
    where department_id = closing_id and user_id = new.closer_id
  ) then
    raise exception 'The closer must be a member of the Closing department';
  end if;

  if exists (
    select 1 from public.department_members
    where department_id = closing_id and user_id = new.agent_id
  ) then
    raise exception 'A closer cannot be placed under another closer';
  end if;

  return new;
end $$;

drop trigger if exists closer_assignment_guard_trg on public.closer_assignments;
create trigger closer_assignment_guard_trg
  before insert or update on public.closer_assignments
  for each row execute function public.closer_assignment_guard();

-- RLS: app writes go through the service role, which bypasses these. The
-- policies exist so a direct client read cannot enumerate the whole org chart:
-- you may see your own row, and a closer may see their own team.
alter table public.closer_assignments enable row level security;

drop policy if exists "read own closer assignment" on public.closer_assignments;
create policy "read own closer assignment" on public.closer_assignments
  for select to authenticated
  using (agent_id = auth.uid() or closer_id = auth.uid() or public.is_admin());

drop policy if exists "admin writes closer assignments" on public.closer_assignments;
create policy "admin writes closer assignments" on public.closer_assignments
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
