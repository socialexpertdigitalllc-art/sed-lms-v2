-- 0001_core_schema.sql — SED LMS v2 core schema + RLS
create extension if not exists "pgcrypto";

-- ============================ profiles ============================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text,
  display_name text,
  avatar_url text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================ departments ============================
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  slug text unique not null,
  description text,
  color text default '#0D9488',
  icon text default 'users',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.department_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  department_id uuid references public.departments(id) on delete cascade,
  dept_role text not null default 'member' check (dept_role in ('member','lead','manager')),
  added_by uuid references public.profiles(id),
  added_at timestamptz not null default now(),
  unique(user_id, department_id)
);

-- ============================ permissions ============================
create table public.permissions (
  key text primary key,
  name text not null,
  description text,
  category text not null,
  is_sensitive boolean not null default false
);

create table public.department_permissions (
  id uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments(id) on delete cascade,
  permission_key text references public.permissions(key) on delete cascade,
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  unique(department_id, permission_key)
);

create table public.user_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  permission_key text references public.permissions(key) on delete cascade,
  is_granted boolean not null,
  reason text,
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  unique(user_id, permission_key)
);

-- ============================ leads ============================
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'Not Ready',
  agent_id uuid references public.profiles(id),
  business_name text not null,
  business_phone text,
  business_email text,
  business_profile_link text,
  website_link text,
  logo_link text,
  map_embed_link text,
  site_type text,
  platform text,
  services text[] default '{}',
  service_areas text[] default '{}',
  has_service_areas boolean,
  client_experience integer,
  num_webpages integer,
  specify_pages text[] default '{}',
  color_scheme text,
  price_quoted numeric(10,2),
  yearly_price text,
  follow_up_time timestamptz,
  direct_line_saved boolean,
  fresh_or_followup text,
  reference_link text,
  image_links text[] default '{}',
  rating smallint check (rating between 1 and 10),
  comments text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index leads_status_idx on public.leads(status) where deleted_at is null;
create index leads_agent_idx on public.leads(agent_id) where deleted_at is null;

-- ============================ pre_leads (Phase 3 UI) ============================
create table public.pre_leads (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.profiles(id),
  business_name text not null,
  phone_number text,
  email text,
  owner_name text,
  google_yelp_link text,
  areas text[] default '{}',
  services text[] default '{}',
  service_offered text,
  service_type text,
  pricing numeric(10,2),
  lead_category text not null,
  status text default 'Next follow up',
  follow_up_time timestamptz,
  comments text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_updated_by uuid references public.profiles(id),
  deleted_at timestamptz
);

-- ============================ ai_generations (Phase 4 UI) ============================
create table public.ai_generations (
  id uuid primary key default gen_random_uuid(),
  tool text not null,
  agent_id uuid references public.profiles(id),
  lead_id uuid references public.leads(id),
  business_name text,
  total_time_ms integer,
  input_time_ms integer,
  ai_time_ms integer,
  num_pages integer,
  page_types text[] default '{}',
  tokens_used integer,
  cost_usd numeric(8,6),
  status text default 'pending',
  word_count integer,
  image_count integer,
  pexels_count integer,
  complexity_score numeric(5,2),
  errors text,
  file_path text,
  created_at timestamptz not null default now()
);

-- ============================ activity_log ============================
create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  action text not null,
  entity_type text,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

-- ============================ updated_at trigger ============================
create or replace function public.touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger trg_leads_touch before update on public.leads
  for each row execute function public.touch_updated_at();
create trigger trg_prelead_touch before update on public.pre_leads
  for each row execute function public.touch_updated_at();

-- ============================ RLS ============================
alter table public.profiles enable row level security;
alter table public.departments enable row level security;
alter table public.department_members enable row level security;
alter table public.permissions enable row level security;
alter table public.department_permissions enable row level security;
alter table public.user_permission_overrides enable row level security;
alter table public.leads enable row level security;
alter table public.pre_leads enable row level security;
alter table public.ai_generations enable row level security;
alter table public.activity_log enable row level security;

-- helper: is the current user a member of the Admin department?
create or replace function public.is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from department_members dm
    join departments d on d.id = dm.department_id
    where dm.user_id = auth.uid() and d.slug = 'admin'
  );
$$;

-- reads
create policy "read own profile or admin" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy "read departments" on public.departments for select to authenticated using (true);
create policy "read permissions" on public.permissions for select to authenticated using (true);
create policy "read dept_members self or admin" on public.department_members for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "read dept_perms" on public.department_permissions for select to authenticated using (true);
create policy "read own overrides or admin" on public.user_permission_overrides for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "read leads" on public.leads for select to authenticated using (true);
create policy "read pre_leads self or admin" on public.pre_leads for select to authenticated
  using (agent_id = auth.uid() or public.is_admin());
create policy "read ai_generations" on public.ai_generations for select to authenticated using (true);
create policy "read activity_log admin" on public.activity_log for select to authenticated
  using (public.is_admin());

-- admin writes on access-control tables (service-role bypasses RLS for app handlers)
create policy "admin writes departments" on public.departments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin writes dept_members" on public.department_members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin writes dept_perms" on public.department_permissions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin writes overrides" on public.user_permission_overrides for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin updates profiles" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
