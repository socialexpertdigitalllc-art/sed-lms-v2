-- 0086_site_agent_options.sql — AI developer run controls + team defaults.
-- Additive only; every column nullable, so runs and settings from before this
-- migration behave exactly as before.
--
-- Why (2026-10-14): Gemini 3.8 Flash replaced 3.7 and minor edits went from
-- 2–9 minutes to 10–17. Each run can now choose its speed (how directly the
-- agent works), time limit, retries and whether it gets a generated map of the
-- site, and the team sets the defaults everyone starts from.
-- See lib/site-agent/options.ts for the shapes.

-- One run's controls, as sent: {speed, time_limit_min, retries, site_map, house_rules}.
alter table public.site_agent_runs add column if not exists options jsonb;

-- The team's defaults: {model, speed, time_limit_min, retries, site_map, house_rules}.
alter table public.app_settings add column if not exists agent_defaults jsonb;
