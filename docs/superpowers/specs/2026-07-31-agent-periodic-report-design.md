# Agent Periodic Report — Design Spec

**Date:** 2026-07-31
**Status:** Approved (Approach A — lifecycle ledger + report)
**Branch:** new feature branch off `main` (NOT `site-builder`)

## Goal

An admin selects a sales agent and a period and gets a complete performance report built
on true pipeline timing: when each lead **arrived** (`created_at`), was **first touched**,
and **exited** the pipeline by **Closed** (won) or **Dropped** (lost). The same timing data
powers new dashboard KPI cards. The report supports performance measurement and future
strategy decisions: every metric is shown as agent vs. team average vs. agent's previous
period.

**Definitions:** Closed = won. Dropped = lost. Both are terminal pipeline exits with their
own timing analysis. Time-to-close = `closed_at - created_at`; time-to-drop =
`dropped_at - created_at`; time-to-first-touch = `first_touch_at - created_at`.

## Out of scope (explicitly deferred)

- Payments-received ledger (all revenue remains quoted/contracted, labeled as such)
- Reopen analytics (the events table records them; no UI/metrics in v1)
- Pre-leads → leads conversion tracking
- Data-hygiene fixes (`yearly_price` TEXT, status CHECK constraint, etc.) — reuse existing
  parsers (`num()` in `lib/dashboard/metrics.ts`) as-is
- Emailing the report (PDF download only in v1)
- Changing the existing dashboard conversion-rate card

## 1. Data model — migration `supabase/migrations/0065_agent_periodic_report.sql` (additive only)

### New table `lead_status_events`

```sql
create table lead_status_events (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references leads(id) on delete cascade,
  from_status text,
  to_status   text not null,
  changed_by  uuid references profiles(id) on delete set null,
  changed_at  timestamptz not null default now(),
  source      text not null default 'app'   -- 'app' | 'backfill' | 'backfill_approx'
);
create index lead_status_events_lead_idx   on lead_status_events (lead_id, changed_at desc);
create index lead_status_events_status_idx on lead_status_events (to_status, changed_at);
alter table lead_status_events enable row level security;
-- No client policies: reads/writes go through permission-checked routes using the
-- service-role client (same pattern as activity_log / user_sessions).
```

### New columns on `leads`

```sql
alter table leads
  add column closed_at      timestamptz,
  add column dropped_at     timestamptz,
  add column first_touch_at timestamptz;
```

Semantics:
- `closed_at` — set when the lead transitions INTO `Closed`; cleared if it later leaves
  `Closed`. Mirrors current state; history stays in `lead_status_events`.
- `dropped_at` — same, for `Dropped`.
- `first_touch_at` — timestamp of the FIRST `lead_follow_ups` row for the lead; set once,
  never cleared.

### Permission seeds (same migration)

- New key `reports.agent_periodic` added to `lib/permissions/constants.ts` and seeded to
  the `admin` and `management` departments (mirrors `analytics.by_agent` seeding in 0029).
- New dashboard visibility keys seeded to all departments (mirrors 0021):
  `dashboard.kpi.closed_in_period`, `dashboard.kpi.avg_time_to_close`,
  `dashboard.kpi.drop_ratio`, `dashboard.kpi.avg_first_touch`.

## 2. Backfill — `scripts/backfill-status-events.mjs` (one-time, idempotent)

Sources, in priority order:
1. `activity_log` rows: `action='lead.status_changed'` (old/new in `old_value`/`new_value`),
   `action='lead.updated'` where `new_value ? 'status'`, and `action='lead.bulk_status'`
   (ids ARRAY in `new_value`, `entity_id` is NULL — must fan out per id).
2. For currently-Closed/Dropped leads with NO status trace in `activity_log`
   (imported/legacy): synthesize one event with `changed_at = leads.updated_at`,
   `source='backfill_approx'`. The report labels timings derived from approx events.

Then per lead: set `closed_at`/`dropped_at` from the latest transition into the lead's
CURRENT status (only if current status is Closed/Dropped), and
`first_touch_at = min(lead_follow_ups.created_at)`.

Idempotency: the script first deletes `lead_status_events` rows where
`source like 'backfill%'`, then re-inserts. `source='app'` rows are never touched.
Runs with the service-role key from `.env.local`. Backfill math (log rows → events +
column values) lives in a pure, unit-tested function; the script is a thin I/O wrapper.

## 3. Dual-write — `lib/leads/statusEvents.ts`

`recordStatusChange(admin, { leadId, from, to, userId, at })`:
inserts the event row AND maintains `closed_at`/`dropped_at` on the lead in the same
request. Call sites (the only three places status changes):

1. `app/api/leads/[id]/route.ts` — PATCH with status change
2. `app/api/leads/[id]/follow-ups/route.ts` — POST with `status_change`; also sets
   `first_touch_at` if null (on EVERY follow-up POST, not only status-changing ones)
3. The bulk status route — one event per affected lead

Failure of the event insert must not fail the user's request (log + continue), matching
how `activity_log` writes behave today.

## 4. Report computation — `lib/reports/agentPeriodic.ts`

Pure server-side module. Input: `(agentId, from: Date, to: Date)`. Fetches via
`createAdminClient()` (callers do the permission check) with targeted selects — filter by
agent/date in SQL, never full-table dumps. Attribution is `leads.agent_id` (owner);
`closed_by` displayed as context only. All lead queries filter `deleted_at is null`.

Output: typed `AgentPeriodicReport` object consumed by both the page and the PDF:

- **Pipeline flow:** arrived / closed / dropped counts in period; closed-and-dropped split
  by fresh (created in period) vs. carry-over (created before); open-at-period-end with
  aging buckets 0–7 / 8–30 / 30+ days.
- **Velocity:** avg AND median time-to-close, time-to-drop, time-to-first-touch;
  close-time distribution buckets (≤1d, ≤3d, ≤7d, ≤14d, ≤30d, >30d); drop split at
  `FAST_DROP_DAYS = 7`: fast drops (quick disqualification) vs. slow drops (worked then
  lost). Metrics derived from `backfill_approx` events carry an `approx` flag.
- **Ratios:** close ratio = closed / (closed + dropped); drop ratio = dropped /
  (closed + dropped); pickup rate from `lead_follow_ups` (rows by this agent in period);
  contracts-sent → closed ratio (contracts by `created_by` + `sent_at` in period).
- **Revenue (by close date):** closed revenue = Σ `price_quoted` of leads closed in
  period; recurring = Σ parsed `yearly_price` of same; avg deal size over closed-in-period
  only. Labeled "quoted/contracted".
- **Regional:** group by `leadRegion()` (existing phone→US-state mapping in `lib/geo`):
  closes, drops, median cycle length per state — agent vs. team for the same state+period.
- **Activity:** follow-ups logged (+ pickup split), contracts sent, sites generated
  (union of `template_generations`, `studio_runs`, `builder_runs` by `created_by`, and
  `ai_generations` by `agent_id`); attendance (hours, late minutes via existing
  `summarize()` in `lib/signin/analytics.ts`) — returned under an optional
  `attendance` field, rendered only when the viewer toggles it on.
- **Benchmarks:** every metric computed three ways — agent, team (all sales-dept members
  over the same period), and the agent's previous period of equal length.

## 5. Report page — `app/(app)/reports/agent/page.tsx`

- Server component; gates with the standard 4-line pattern: no `reports.agent_periodic`
  → `redirect('/dashboard')`. Sidebar entry gated on the same key.
- Controls: agent dropdown (sales roster via admin client, INCLUDING deactivated
  profiles, marked as such) + period picker: month presets plus custom from/to range
  (not limited to the dashboard's `YYYY-MM` model).
- Renders the report object with existing dashboard component idioms (KPI cards, strips,
  simple charts). Attendance section behind a toggle, off by default.
- Data flows through a `POST /api/reports/agent` route (permission-checked, returns the
  report JSON) so page and PDF share one entry point.

## 6. PDF export — `app/api/reports/agent/pdf/route.ts`

- Same permission check; same computation module; rendered by a new
  `lib/reports/ReportDocument.tsx` with `@react-pdf/renderer` following
  `lib/contracts/ContractDocument.tsx` conventions (`export const runtime='nodejs'`;
  images as `{data: Buffer, format:'png'}`, never data-URI strings).
- Streams the PDF as a download; not persisted to storage.

## 7. Dashboard KPI cards

New pure function `computeVelocityKpis(leads, monthScope)` in `lib/dashboard/metrics.ts`
(or sibling module): closed-in-period (count `closed_at` within scope), avg time-to-close,
drop ratio, avg time-to-first-touch. Wired into `DashboardBoard` + the
`lib/dashboard/visibility.ts` KEYMAP under the four new permission keys. Note: these KPIs
scope by `closed_at`/`dropped_at` within the selected month — deliberately different from
the existing cards' `created_at` scoping; card subtitles make this explicit.
The leads fetch already uses `select('*')`, so the new columns arrive for free.

## 8. Testing

Vitest units (follow `tests/` conventions):
- `statusEvents` helper: event write + column maintenance incl. leaving Closed clears
  `closed_at`.
- Backfill pure function: activity-log fixtures (status_changed, updated-with-status,
  bulk, legacy-no-trace) → expected events + column values; idempotency.
- Report math: aging buckets, median vs. avg, distribution edges, fast/slow drop split,
  ratio denominators (zero-decision periods), previous-period window math, region
  grouping fallback to 'Unknown'.
- `computeVelocityKpis` month-scope boundaries.

## 9. Rollout (shared prod DB — order is mandatory)

1. Apply migration 0065 to prod (additive; safe while old code runs).
2. Deploy code (pm2 `sed-lms`).
3. Run the backfill script once; spot-check a handful of known leads.

Migration numbered 0065 to avoid collision with `site-builder`'s 0063/0064 regardless of
merge order. No cron/secret routes in v1 → no middleware allowlist changes needed.

## Risks / notes

- `activity_log` has no `(user_id, created_at)` index; the backfill scans it ONCE, and
  runtime reports never touch it (they read `lead_status_events` / `leads` columns).
- Bulk status rows (`entity_id` NULL, ids array) are the trickiest backfill case — covered
  by dedicated fixtures.
- Leads whose agent was deleted group under an "Unknown agent" bucket; deactivated agents
  stay selectable for historical periods.
- This Next.js version has breaking changes (route-handler `params` is a Promise, etc.) —
  read `node_modules/next/dist/docs/` before writing the new routes/pages.
