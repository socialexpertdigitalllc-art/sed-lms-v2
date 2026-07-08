-- 0015_signin_logs.sql — sign-in session logging + company work settings

-- Per-sign-in session rows
create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  signed_in_at timestamptz not null default now(),
  signed_out_at timestamptz,
  last_seen_at timestamptz not null default now(),
  end_reason text check (end_reason in ('logout','idle_timeout')),
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists user_sessions_user_signed_in_idx
  on public.user_sessions (user_id, signed_in_at desc);
create index if not exists user_sessions_open_idx
  on public.user_sessions (last_seen_at) where signed_out_at is null;

alter table public.user_sessions enable row level security;
-- No client policy: all reads/writes go through the service role (mirrors user_activity).

-- Company-wide settings singleton (mirrors wge_config / import_config)
create table if not exists public.app_settings (
  singleton boolean not null default true unique,
  work_start_time time not null default '09:00',
  work_timezone text not null default 'Asia/Karachi',
  idle_timeout_minutes int not null default 15,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.app_settings enable row level security;
create policy "read app_settings authenticated" on public.app_settings
  for select to authenticated using (true);

insert into public.app_settings (singleton) values (true)
  on conflict (singleton) do nothing;

-- Close sessions that have gone idle past the configured timeout
create or replace function public.close_stale_sessions()
returns integer language plpgsql security definer set search_path = public as $$
declare
  mins int;
  n int;
begin
  select idle_timeout_minutes into mins from public.app_settings where singleton limit 1;
  if mins is null then mins := 15; end if;
  update public.user_sessions
     set signed_out_at = last_seen_at, end_reason = 'idle_timeout'
   where signed_out_at is null
     and last_seen_at < now() - make_interval(mins => mins);
  get diagnostics n = row_count;
  return n;
end $$;

-- Permission: manage company settings + add-ons catalog
insert into public.permissions (key, name, description, category, is_sensitive) values
  ('admin.settings.manage','Manage App Settings & Add-ons',null,'admin',true)
  on conflict (key) do nothing;
insert into public.department_permissions (department_id, permission_key)
  select d.id, 'admin.settings.manage' from public.departments d
   where d.slug in ('admin','management')
  on conflict do nothing;
