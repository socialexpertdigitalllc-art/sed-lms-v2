-- 0024_lead_assign_perm.sql — permission for (bulk) assigning/reassigning a lead's agent

insert into public.permissions (key, name, description, category, is_sensitive) values
  ('leads.assign','Assign / Reassign Lead',null,'leads',true)
on conflict (key) do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, 'leads.assign' from public.departments d
  where d.slug in ('admin')
on conflict do nothing;
