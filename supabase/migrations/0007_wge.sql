-- WGE-1: Website Generation Engine control config

create table if not exists public.wge_config (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique,
  system_prompt text not null,
  prompt_template text not null,
  variables jsonb not null default '[]',
  settings jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

alter table public.wge_config enable row level security;

-- any authenticated user who can use AI tools may read the config (the
-- generator needs it). Writes happen via the service role behind the API guard.
create policy "read wge_config" on public.wge_config for select to authenticated using (true);

-- new permission + grant for fresh installs / existing tech dept
insert into public.permissions (key, name, description, category, is_sensitive) values
  ('wge.manage','Manage Website Engine (WGE)',null,'ai_tools',true)
on conflict (key) do nothing;

insert into public.department_permissions (department_id, permission_key)
select d.id, 'wge.manage' from public.departments d where d.slug = 'tech'
on conflict do nothing;
