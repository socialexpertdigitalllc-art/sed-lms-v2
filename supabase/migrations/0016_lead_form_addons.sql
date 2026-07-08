-- 0016_lead_form_addons.sql — new lead columns, add-ons catalog, dup-override perm

alter table public.leads
  add column if not exists design_reference_links text[] not null default '{}',
  add column if not exists add_ons jsonb not null default '[]',
  add column if not exists no_email boolean not null default false,
  add column if not exists logo_via_sms boolean not null default false,
  add column if not exists color_same_as_logo boolean not null default false,
  add column if not exists closed_by uuid references public.profiles(id) on delete set null;

create table if not exists public.website_addons (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  price numeric(10,2),
  is_active boolean not null default true,
  sort int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.website_addons enable row level security;
create policy "read website_addons authenticated" on public.website_addons
  for select to authenticated using (true);
-- writes via service role only (guarded by admin.settings.manage in the route)

insert into public.permissions (key, name, description, category, is_sensitive) values
  ('leads.duplicate.override','Override Duplicate Lead Block',null,'leads',true)
  on conflict (key) do nothing;
insert into public.department_permissions (department_id, permission_key)
  select d.id, 'leads.duplicate.override' from public.departments d
   where d.slug in ('admin','management')
  on conflict do nothing;
