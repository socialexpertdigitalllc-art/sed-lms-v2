-- Per-category lead permissions: which categories a user can VIEW and which
-- they can SET a lead to. Slug = lower(replace(status,' ','_')).

insert into public.permissions (key, name, description, category, is_sensitive) values
  ('leads.cat_view.ready','View Ready Leads','Can see leads in the Ready category','leads',false),
  ('leads.cat_view.not_ready','View Not Ready Leads','Can see leads in the Not Ready category','leads',false),
  ('leads.cat_view.closed','View Closed Leads','Can see leads in the Closed category','leads',false),
  ('leads.cat_view.dropped','View Dropped Leads','Can see leads in the Dropped category','leads',false),
  ('leads.cat_view.long_term','View Long Term Leads','Can see leads in the Long Term category','leads',false),
  ('leads.cat_set.ready','Set Lead to Ready','Can set a lead''s status to Ready','leads',false),
  ('leads.cat_set.not_ready','Set Lead to Not Ready','Can set a lead''s status to Not Ready','leads',false),
  ('leads.cat_set.closed','Set Lead to Closed','Can set a lead''s status to Closed','leads',false),
  ('leads.cat_set.dropped','Set Lead to Dropped','Can set a lead''s status to Dropped','leads',false),
  ('leads.cat_set.long_term','Set Lead to Long Term','Can set a lead''s status to Long Term','leads',false)
on conflict (key) do nothing;

-- Zero-disruption seeding:
-- every dept that can view leads keeps seeing every category…
insert into public.department_permissions (department_id, permission_key)
select d.department_id, v.key
from (select distinct department_id from public.department_permissions
      where permission_key = 'leads.view') d
cross join (values
  ('leads.cat_view.ready'),('leads.cat_view.not_ready'),('leads.cat_view.closed'),
  ('leads.cat_view.dropped'),('leads.cat_view.long_term')) v(key)
on conflict do nothing;

-- …and every dept that can change status OR create leads keeps every set-target.
-- (Creating a lead requires cat_set for its initial status; sales has
-- leads.create without leads.status_change.)
insert into public.department_permissions (department_id, permission_key)
select d.department_id, v.key
from (select distinct department_id from public.department_permissions
      where permission_key in ('leads.status_change','leads.create')) d
cross join (values
  ('leads.cat_set.ready'),('leads.cat_set.not_ready'),('leads.cat_set.closed'),
  ('leads.cat_set.dropped'),('leads.cat_set.long_term')) v(key)
on conflict do nothing;

-- Category visibility enforced at the database. A row is visible only if the
-- user could already see it (view_all or own) AND may view its category.
drop policy if exists "read leads scoped" on public.leads;
create policy "read leads scoped" on public.leads for select to authenticated
  using (
    (public.has_permission('leads.view_all') or agent_id = auth.uid())
    and public.has_permission('leads.cat_view.' || lower(replace(status, ' ', '_')))
  );
