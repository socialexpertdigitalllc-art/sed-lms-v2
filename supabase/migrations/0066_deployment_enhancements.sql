-- 0066: deployment system enhancements
-- 1) allow 'manual' origin on studio_deployments (manually uploaded sites become tracked)
alter table public.studio_deployments drop constraint if exists studio_deployments_origin_check;
alter table public.studio_deployments add constraint studio_deployments_origin_check
  check (origin in ('studio', 'v2_import', 'builder', 'manual'));

-- 2) machine-readable live-site URL on notifications (for "open website" actions)
alter table public.notifications add column if not exists website_url text;

-- 3) per-user follow-up reminder status filter (revives the dormant settings table;
--    null = all follow-up-eligible statuses)
alter table public.user_notification_settings add column if not exists statuses text[];

-- 4) custom-domain go-live notification rule: lead agent + Management department
insert into public.notification_rules (event_key, enabled, target_departments, target_users, target_roles, delay_minutes)
values ('website_custom_domain', true, '{Management}', '{}', '{lead_agent}', 0)
on conflict (event_key) do nothing;
