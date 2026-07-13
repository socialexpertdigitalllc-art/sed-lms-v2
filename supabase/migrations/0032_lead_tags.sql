-- 0032_lead_tags.sql — custom lead tags: catalog + M2M links + RLS + permissions
--
-- `leads.tags.view`   — see tags on leads and filter the leads list by tag.
-- `leads.tags.manage` — create/edit/delete tags and apply them to leads.
-- Sales gets view by default; management + admin get view + manage. Admin can
-- extend manage to any department via the permission grid (that's the point of
-- permission-gating the feature).

-- Tag catalog.
create table if not exists public.lead_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default 'slate',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(name)
);

-- Lead <-> tag join (mirrors department_members).
create table if not exists public.lead_tag_links (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  tag_id uuid not null references public.lead_tags(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  unique(lead_id, tag_id)
);
create index if not exists lead_tag_links_lead_idx on public.lead_tag_links (lead_id);
create index if not exists lead_tag_links_tag_idx on public.lead_tag_links (tag_id);

alter table public.lead_tags enable row level security;
alter table public.lead_tag_links enable row level security;

-- SELECT: either tag permission. Writes are done by the service role in the
-- API (guarded by leads.tags.manage), but keep a manage-gated write policy so
-- direct authenticated writes are also constrained.
create policy "read lead tags" on public.lead_tags for select to authenticated
  using (public.has_permission('leads.tags.view') or public.has_permission('leads.tags.manage'));
create policy "write lead tags" on public.lead_tags for all to authenticated
  using (public.has_permission('leads.tags.manage'))
  with check (public.has_permission('leads.tags.manage'));

create policy "read lead tag links" on public.lead_tag_links for select to authenticated
  using (public.has_permission('leads.tags.view') or public.has_permission('leads.tags.manage'));
create policy "write lead tag links" on public.lead_tag_links for all to authenticated
  using (public.has_permission('leads.tags.manage'))
  with check (public.has_permission('leads.tags.manage'));

-- Realtime: sidebar/table refresh on link changes.
alter table public.lead_tag_links replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.lead_tag_links;
exception when duplicate_object then null; end $$;

insert into public.permissions (key, name, description, category, is_sensitive) values
  ('leads.tags.view','View & Filter Tags','See lead tags and filter leads by tag','leads',false),
  ('leads.tags.manage','Manage Lead Tags','Create/edit/delete tags and apply them to leads','leads',false)
on conflict (key) do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, k.key from public.departments d
  cross join (values ('leads.tags.view'),('leads.tags.manage')) as k(key)
  where (d.slug, k.key) in (
    ('sales','leads.tags.view'),
    ('management','leads.tags.view'),('management','leads.tags.manage'),
    ('admin','leads.tags.view'),('admin','leads.tags.manage')
  )
on conflict do nothing;
