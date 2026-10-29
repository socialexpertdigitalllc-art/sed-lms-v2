-- 0095_lead_hitlist.sql — the HitList: one company-wide list of premium leads,
-- each with a 1–5 star priority. Admins add and remove (hitlist.manage);
-- closers only view (hitlist.view). Shown as a golden star beside the business
-- name in the leads table, a "Hit list" filter there, and the /hitlist tab.
-- ADDITIVE ONLY (shared prod DB): one new table, two permissions, grants.
--
-- One row per lead. Kept off `leads` on purpose: starring a lead must not bump
-- its updated_at or count as an edit in the lead's history.

create table if not exists public.lead_hitlist (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  priority smallint not null check (priority between 1 and 5),
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lead_hitlist_priority_idx on public.lead_hitlist (priority desc);

-- Reads: anyone who can view the hit list (so realtime reaches closers too).
-- Writes: only the service role, behind hitlist.manage in /api/hitlist/[leadId].
alter table public.lead_hitlist enable row level security;
drop policy if exists "read hitlist" on public.lead_hitlist;
create policy "read hitlist" on public.lead_hitlist for select to authenticated
  using (public.has_permission('hitlist.view'));

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='lead_hitlist') then
    alter publication supabase_realtime add table public.lead_hitlist;
  end if;
end $$;

insert into public.permissions (key, name, description, category, is_sensitive) values
  ('hitlist.view','View HitList',null,'hitlist',false),
  ('hitlist.manage','Add / Remove HitList Leads',null,'hitlist',true)
on conflict (key) do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, k.key from public.departments d
  cross join (values ('hitlist.view'),('hitlist.manage')) as k(key)
  where d.slug in ('admin')
on conflict do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, 'hitlist.view' from public.departments d where d.slug in ('closing')
on conflict do nothing;
