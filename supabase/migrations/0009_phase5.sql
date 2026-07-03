-- Phase 5: user-activity tracker, import config, admin.import perm, realtime

create table if not exists public.user_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  type text not null,            -- page_view | click | focus
  path text,
  label text,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_user_activity_user_created on public.user_activity (user_id, created_at desc);
create index if not exists idx_user_activity_created on public.user_activity (created_at);
alter table public.user_activity enable row level security;
-- intentionally NO client policy: viewer reads + track endpoint inserts both use the service role

create or replace function public.prune_user_activity() returns void
language sql security definer set search_path = public as $$
  delete from public.user_activity where created_at < now() - interval '90 days';
$$;

create table if not exists public.import_config (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique,
  sheet_id text not null default '1KBWPYJHyXiradB9csWMYEnlFPXVHGDTyc1pmv3uB8sk',
  sheet_tab text not null default 'New (April 2026)',
  mapping jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
alter table public.import_config enable row level security;
create policy "read import_config" on public.import_config for select to authenticated
  using (public.has_permission('admin.import'));

insert into public.permissions (key, name, description, category, is_sensitive) values
  ('admin.import','Import Leads','Bulk-import leads from Google Sheets','admin',true)
on conflict (key) do nothing;
insert into public.department_permissions (department_id, permission_key)
select d.id, 'admin.import' from public.departments d where d.slug in ('admin','tech')
on conflict do nothing;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='leads') then
    alter publication supabase_realtime add table public.leads;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='pre_leads') then
    alter publication supabase_realtime add table public.pre_leads;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='wge_queue') then
    alter publication supabase_realtime add table public.wge_queue;
  end if;
end $$;
