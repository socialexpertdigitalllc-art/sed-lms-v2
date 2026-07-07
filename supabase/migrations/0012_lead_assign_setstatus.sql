-- New-lead submission controls: who may assign a lead to an agent, and who may
-- choose its initial status. Users lacking these get auto-self-assign + "Not Ready".

insert into public.permissions (key, name, description, category, is_sensitive) values
  ('leads.assign','Assign Lead to an Agent','Choose which agent a new lead is assigned to (otherwise the submitter is assigned)','leads',false),
  ('leads.set_status','Set Status on New Lead','Choose a new lead''s status (otherwise it defaults to Not Ready)','leads',false)
on conflict (key) do nothing;

-- Grant both to any department that can already change lead status
-- (admin + management); sales/support/tech do not get them.
insert into public.department_permissions (department_id, permission_key)
select d.department_id, v.key
from (select distinct department_id from public.department_permissions
      where permission_key = 'leads.status_change') d
cross join (values ('leads.assign'), ('leads.set_status')) v(key)
on conflict do nothing;
