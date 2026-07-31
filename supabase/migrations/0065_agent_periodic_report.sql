-- 0065_agent_periodic_report.sql — lead lifecycle ledger + Agent Periodic Report permissions.
--
-- FILE ONLY. Do NOT apply — the operator's DB is production; they apply this
-- after review (see AGENTS.md).
--
-- ADDITIVE ONLY. Shared prod DB: one new table, three nullable columns on
-- leads, permission seeds. No drops, no type changes, no edits to existing
-- columns or data. NULL in the new lead columns means "not currently in that
-- state / never touched" until the backfill script runs.
--
-- Why: leads only store their CURRENT status; the moment a lead was Closed or
-- Dropped exists solely inside activity_log jsonb. lead_status_events is the
-- permanent, queryable ledger; closed_at/dropped_at/first_touch_at are
-- denormalized mirrors of the latest state for cheap dashboard/report scans.

create table if not exists public.lead_status_events (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads(id) on delete cascade,
  from_status text,
  to_status   text not null,
  changed_by  uuid references public.profiles(id) on delete set null,
  changed_at  timestamptz not null default now(),
  -- 'app' = written live by a route; 'backfill' = reconstructed from
  -- activity_log; 'backfill_approx' = legacy lead with no log trace, timestamp
  -- approximated from leads.updated_at.
  source      text not null default 'app'
);

create index if not exists lead_status_events_lead_idx
  on public.lead_status_events (lead_id, changed_at desc);
create index if not exists lead_status_events_status_idx
  on public.lead_status_events (to_status, changed_at);

-- Service-role only (like activity_log / user_sessions): RLS on, no policies.
alter table public.lead_status_events enable row level security;

alter table public.leads
  add column if not exists closed_at      timestamptz,
  add column if not exists dropped_at     timestamptz,
  add column if not exists first_touch_at timestamptz;

-- Report page gate: admin + management only (mirrors analytics.by_agent, 0029).
insert into public.permissions (key, name, description, category, is_sensitive) values
  ('reports.agent_periodic','Agent Periodic Report','Generate per-agent periodic performance reports','analytics',true)
on conflict (key) do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, k.key from public.departments d
  cross join (values ('reports.agent_periodic')) as k(key)
  where (d.slug, k.key) in (
    ('management','reports.agent_periodic'),
    ('admin','reports.agent_periodic')
  )
on conflict do nothing;

-- Four new dashboard KPI cards, seeded to ALL departments (0021 default-on
-- convention). NOTE: deliberately NOT the 0021 category-wide cross join — that
-- would re-grant every dashboard permission and undo admin revocations made
-- since. Only the four new keys are granted.
insert into public.permissions (key, name, description, category, is_sensitive) values
  ('dashboard.kpi.closed_in_period','KPI: Closed (Period)',null,'dashboard',false),
  ('dashboard.kpi.avg_time_to_close','KPI: Avg Time To Close',null,'dashboard',false),
  ('dashboard.kpi.drop_ratio','KPI: Drop Ratio',null,'dashboard',false),
  ('dashboard.kpi.avg_first_touch','KPI: Avg Time To First Touch',null,'dashboard',false)
on conflict (key) do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, k.key from public.departments d
  cross join (values
    ('dashboard.kpi.closed_in_period'),
    ('dashboard.kpi.avg_time_to_close'),
    ('dashboard.kpi.drop_ratio'),
    ('dashboard.kpi.avg_first_touch')
  ) as k(key)
on conflict do nothing;
