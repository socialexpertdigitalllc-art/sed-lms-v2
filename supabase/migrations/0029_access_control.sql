-- 0029_access_control.sql — ticket user-scoping + By-Agent analytics permission
--
-- `tickets.view_all`: without it, users see only tickets they created or
-- tickets on leads assigned to them (enforced in app code via lib/tickets/scope).
-- `analytics.by_agent`: gates the /by-agent page (was analytics.view).
--
-- Note: `leads.set_status` (checked by app/api/leads/route.ts) is already
-- seeded by 0012_lead_assign_setstatus.sql — not re-inserted here.

insert into public.permissions (key, name, description, category, is_sensitive) values
  ('tickets.view_all','View All Tickets','See every ticket, not just own/assigned-lead tickets','tickets',true),
  ('analytics.by_agent','View By-Agent Analytics',null,'analytics',true)
on conflict (key) do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, k.key from public.departments d
  cross join (values ('tickets.view_all'),('analytics.by_agent')) as k(key)
  where (d.slug, k.key) in (
    ('tech','tickets.view_all'),
    ('management','tickets.view_all'),('management','analytics.by_agent'),
    ('admin','tickets.view_all'),('admin','analytics.by_agent')
  )
on conflict do nothing;
