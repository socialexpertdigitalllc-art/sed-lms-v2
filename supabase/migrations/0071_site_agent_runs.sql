-- 0071_site_agent_runs.sql — Ticket Agent: AI website edits from tickets.
-- Additive only. See docs/superpowers/specs/2026-09-01-ticket-agent-design.md.

create table if not exists public.site_agent_runs (
  id              uuid primary key default gen_random_uuid(),
  ticket_id       uuid references public.lead_tickets(id) on delete set null,
  lead_id         uuid references public.leads(id) on delete set null,
  site_host       text not null,
  status          text not null default 'queued'
                  check (status in ('queued','running','review','deploying','deployed','failed','discarded')),
  claim_id        uuid,
  conversation_id text,
  instructions    text,
  files           jsonb not null default '{}'::jsonb,
  output_tail     text,
  summary         text,
  usage           jsonb,
  error           text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One in-flight run per ticket; review counts as in-flight (it holds the slot
-- until the developer approves/discards/revises).
create unique index if not exists site_agent_runs_one_active_per_ticket
  on public.site_agent_runs (ticket_id)
  where status in ('queued','running','review','deploying');

-- The worker polls `where status in (...) order by created_at` every ~20s
-- forever — same reason studio_runs (0053) and builder_runs (0057) carry
-- their (status, created_at) composite. And the ticket screen lists a
-- ticket's FULL run history (terminal statuses too), which the partial
-- unique index above cannot serve.
create index if not exists site_agent_runs_status_created
  on public.site_agent_runs (status, created_at);
create index if not exists site_agent_runs_ticket
  on public.site_agent_runs (ticket_id);

-- Service-role only, like studio_deployments: RLS on, zero policies.
alter table public.site_agent_runs enable row level security;

-- Private bucket for original/result zips ({runId}/original.zip, {runId}/result.zip).
insert into storage.buckets (id, name, public)
values ('agent-sites', 'agent-sites', false)
on conflict (id) do nothing;

-- Worker liveness (the dashboard shows "worker offline" when stale).
alter table public.app_settings add column if not exists agent_worker_seen_at timestamptz;

-- Notification rules (lowercase dept slugs ONLY — the 0066 '{Management}' seed
-- is a known inert-row bug; target roles instead).
insert into public.notification_rules (event_key, enabled, target_departments, target_users, target_roles, delay_minutes)
values
  ('site_agent_run_ready',  true, '{}', '{}', '{ticket_assignee}', 0),
  ('site_agent_run_failed', true, '{}', '{}', '{ticket_assignee}', 0)
on conflict (event_key) do nothing;
