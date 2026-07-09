-- 0022_payment_links.sql — payment link catalog + Accounts department + perms

create table if not exists public.payment_links (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  amount numeric(10,2) not null check (amount > 0),
  currency text not null default 'USD',
  category text not null default 'Website' check (category in ('Website','Yearly','Add-on','Other')),
  url text not null,
  notes text,
  provider text not null default 'stripe',
  external_id text,
  is_active boolean not null default true,
  sort int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payment_links_cat_sort_idx on public.payment_links (category, sort, created_at);

alter table public.payment_links enable row level security;
create policy "read payment links" on public.payment_links for select to authenticated
  using (public.has_permission('payments.view'));
-- writes via service role only (guarded by payments.manage in the routes)

insert into public.departments (name, slug, description, color, icon)
values ('Accounts','accounts','Payments & billing','#CA8A04','wallet')
on conflict (slug) do nothing;

insert into public.permissions (key, name, description, category, is_sensitive) values
  ('payments.view','View Payment Links',null,'payments',false),
  ('payments.manage','Manage Payment Links',null,'payments',true)
on conflict (key) do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, k.key from public.departments d
  cross join (values ('payments.view'),('payments.manage')) as k(key)
  where d.slug in ('accounts','admin')
on conflict do nothing;
