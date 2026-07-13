-- 0030_website_link_added_rule.sql — seed a routing rule for the website_link_added event
-- (mirrors 0020's website_ready row: enabled, no dept/user targets, lead_agent role, no delay).
-- Without a rule row, notify() no-ops for this event.

insert into public.notification_rules (event_key, enabled, target_departments, target_users, target_roles, delay_minutes) values
  ('website_link_added', true, '{}', '{}', '{lead_agent}', 0)
on conflict (event_key) do nothing;
