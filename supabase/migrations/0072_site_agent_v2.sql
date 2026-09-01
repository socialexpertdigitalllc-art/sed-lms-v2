-- 0072_site_agent_v2.sql — Ticket Agent v2: run scope/task/model + worker model registry.
-- Additive only. See docs/superpowers/specs/2026-09-02-ticket-agent-v2-design.md.

-- F1/F4: partial-run scope, operator-edited task text, and chosen agy model —
-- all nullable so v1 runs (created before this migration) behave exactly as before.
alter table public.site_agent_runs add column if not exists item_ids jsonb;
alter table public.site_agent_runs add column if not exists task_text text;
alter table public.site_agent_runs add column if not exists model text;

-- F2: the worker's live `agy models` catalogue, republished at most every
-- MODELS_REFRESH_MS — never hardcoded in our code (models change on agy's side).
alter table public.app_settings add column if not exists agent_worker_models jsonb;

-- F5: one in-flight TICKETLESS run per lead (direct site edits). The 0071 index
-- above only guards ticket_id, so a null-ticket run needs its own slot per lead;
-- ticket runs are excluded here (ticket_id is null) so the two indexes never overlap.
create unique index if not exists site_agent_runs_one_active_per_lead
  on public.site_agent_runs (lead_id)
  where status in ('queued','running','review','deploying') and ticket_id is null;
