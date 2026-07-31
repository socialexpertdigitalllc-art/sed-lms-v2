# Agent Periodic Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin picks a sales agent + period and gets a full performance report (pipeline flow, time-to-close/drop velocity, ratios, revenue by close date, regional breakdown, activity) built on a new lead lifecycle ledger, plus four new time-aware dashboard KPI cards.

**Architecture:** One additive migration adds `lead_status_events` + `closed_at`/`dropped_at`/`first_touch_at` columns on `leads`; the three status-changing API routes dual-write events; a one-time script backfills history from `activity_log`. A pure report-math module computes metrics for (agent, team, previous-period); a POST route serves JSON to a report page and a GET route renders the same data with react-pdf.

**Tech Stack:** Next.js App Router (NONSTANDARD — route-handler `params` is a `Promise`, must be awaited), Supabase (service-role via `createAdminClient()` after explicit permission checks), zod, `@react-pdf/renderer` ^4.5.1 (already installed), vitest (jsdom, tests flat in `tests/`).

**Spec:** `docs/superpowers/specs/2026-07-31-agent-periodic-report-design.md`

**Repo law (do not violate):**
- Migrations are FILE ONLY — the operator applies them to the shared prod DB after review. Never run them yourself.
- Repo-root globbing times out (node_modules). Scope all searches to `app/`, `lib/`, `tests/`, `supabase/`.
- Read `node_modules/next/dist/docs/` before writing any new route/page if unsure — this Next.js differs from training data.
- Out of scope (user decision): payments-received ledger, reopen analytics, pre-leads linking, data-hygiene fixes, emailing reports, touching the existing conversion-rate card.

---

### Task 0: Feature branch + docs

**Files:**
- Commit: `docs/superpowers/specs/2026-07-31-agent-periodic-report-design.md`, `docs/superpowers/plans/2026-07-31-agent-periodic-report.md`

- [ ] **Step 0.1:** Create an isolated workspace on a new branch `agent-periodic-report` off `main` (use superpowers:using-git-worktrees — the current checkout is on `site-builder` with unrelated uncommitted WIP; do NOT touch it). Copy the two docs above from the `site-builder` working tree into the worktree (they are untracked there).
- [ ] **Step 0.2:** Commit:

```bash
git add docs/superpowers/specs/2026-07-31-agent-periodic-report-design.md docs/superpowers/plans/2026-07-31-agent-periodic-report.md
git commit -m "docs(reports): spec + plan for Agent Periodic Report"
```

---

### Task 1: Migration 0065 + permission catalog entries

**Files:**
- Create: `supabase/migrations/0065_agent_periodic_report.sql`
- Modify: `lib/permissions/constants.ts` (two insertion points)

- [ ] **Step 1.1: Write the migration file** (FILE ONLY — never apply it yourself):

```sql
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
```

- [ ] **Step 1.2: Register the keys in the TS catalog.** In `lib/permissions/constants.ts`, after the line `{ key: "analytics.by_agent", name: "View By-Agent Analytics", category: "analytics", is_sensitive: true },` add:

```ts
  { key: "reports.agent_periodic", name: "Agent Periodic Report", category: "analytics", is_sensitive: true },
```

and after the line `{ key: "dashboard.kpi.avg_resolution_time", name: "KPI: Avg Ticket Resolution Time", category: "dashboard" },` add:

```ts
  { key: "dashboard.kpi.closed_in_period", name: "KPI: Closed (Period)", category: "dashboard" },
  { key: "dashboard.kpi.avg_time_to_close", name: "KPI: Avg Time To Close", category: "dashboard" },
  { key: "dashboard.kpi.drop_ratio", name: "KPI: Drop Ratio", category: "dashboard" },
  { key: "dashboard.kpi.avg_first_touch", name: "KPI: Avg Time To First Touch", category: "dashboard" },
```

(Fields are `key`/`name`/`category`/`is_sensitive` — NOT `label`/`sensitive`. Category stays `analytics`; do not touch `PERMISSION_CATEGORIES`.)

- [ ] **Step 1.3:** Run: `npm test` → expected: all existing tests PASS (nothing consumed the catalog additively). Then commit:

```bash
git add supabase/migrations/0065_agent_periodic_report.sql lib/permissions/constants.ts
git commit -m "feat(reports): migration 0065 — lead_status_events ledger + report/KPI permissions"
```

---

### Task 2: Lead type + test-fixture updates

Adding fields to the `Lead` interface breaks every full-fixture factory, so this lands as its own compile-green task.

**Files:**
- Modify: `lib/leads/types.ts` (Lead interface)
- Modify: `tests/dashboardMetrics.test.ts`, `tests/analytics.test.ts` (fixture factories)

- [ ] **Step 2.1:** In `lib/leads/types.ts`, inside `export interface Lead`, after the line `no_pickup_streak: number;` add:

```ts
  /** Set when the lead enters Closed; cleared if it leaves. Ledger: lead_status_events. */
  closed_at: string | null;
  /** Set when the lead enters Dropped; cleared if it leaves. */
  dropped_at: string | null;
  /** First follow-up ever logged on this lead. Set once. */
  first_touch_at: string | null;
```

- [ ] **Step 2.2:** Run: `npx tsc --noEmit` → expected: errors ONLY in the two test fixture factories (objects no longer satisfy `Lead`). In each factory's defaults object (`lead()` in `tests/dashboardMetrics.test.ts`, `mk()` in `tests/analytics.test.ts`), add alongside the other null defaults:

```ts
    closed_at: null,
    dropped_at: null,
    first_touch_at: null,
```

- [ ] **Step 2.3:** Run: `npx tsc --noEmit` → expected: clean. Run `npm test` → expected: PASS. Commit:

```bash
git add lib/leads/types.ts tests/dashboardMetrics.test.ts tests/analytics.test.ts
git commit -m "feat(reports): closed_at/dropped_at/first_touch_at on the Lead type"
```

---

### Task 3: `recordStatusChange` helper (TDD)

**Files:**
- Create: `lib/leads/statusEvents.ts`
- Test: `tests/statusEvents.test.ts`

- [ ] **Step 3.1: Write the failing test:**

```ts
import { describe, it, expect } from "vitest";
import { statusTimestampPatch } from "@/lib/leads/statusEvents";

const AT = "2026-07-15T10:00:00.000Z";

describe("statusTimestampPatch", () => {
  it("entering Closed stamps closed_at and clears dropped_at", () => {
    expect(statusTimestampPatch("Closed", AT)).toEqual({ closed_at: AT, dropped_at: null });
  });
  it("entering Dropped stamps dropped_at and clears closed_at", () => {
    expect(statusTimestampPatch("Dropped", AT)).toEqual({ closed_at: null, dropped_at: AT });
  });
  it("entering any open status clears both", () => {
    for (const s of ["Ready", "Not Ready", "Long Term"]) {
      expect(statusTimestampPatch(s, AT)).toEqual({ closed_at: null, dropped_at: null });
    }
  });
});
```

- [ ] **Step 3.2:** Run: `npx vitest run tests/statusEvents.test.ts` → expected: FAIL (module not found).
- [ ] **Step 3.3: Implement `lib/leads/statusEvents.ts`:**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Denormalized mirror of the ledger: entering Closed/Dropped stamps that
 * column and clears the other; entering any open status clears both. History
 * survives in lead_status_events regardless.
 */
export function statusTimestampPatch(
  to: string,
  at: string
): { closed_at: string | null; dropped_at: string | null } {
  return {
    closed_at: to === "Closed" ? at : null,
    dropped_at: to === "Dropped" ? at : null,
  };
}

/** Ledger write + column maintenance. Log-and-continue like activity_log. */
export async function recordStatusChange(
  admin: SupabaseClient,
  args: { leadId: string; from: string | null; to: string; userId: string | null; at?: string }
): Promise<void> {
  const at = args.at ?? new Date().toISOString();
  const { error: evError } = await admin.from("lead_status_events").insert({
    lead_id: args.leadId,
    from_status: args.from,
    to_status: args.to,
    changed_by: args.userId,
    changed_at: at,
    source: "app",
  });
  if (evError) console.error("[statusEvents] event insert failed:", evError.message);
  const { error: patchError } = await admin
    .from("leads")
    .update(statusTimestampPatch(args.to, at))
    .eq("id", args.leadId);
  if (patchError) console.error("[statusEvents] lead patch failed:", patchError.message);
}

/** Bulk variant: one event batch + one column update for N leads → `to`. */
export async function bulkRecordStatusChanges(
  admin: SupabaseClient,
  rows: { id: string; status: string }[],
  to: string,
  userId: string | null
): Promise<void> {
  if (rows.length === 0) return;
  const at = new Date().toISOString();
  const { error: evError } = await admin.from("lead_status_events").insert(
    rows.map((r) => ({
      lead_id: r.id,
      from_status: r.status,
      to_status: to,
      changed_by: userId,
      changed_at: at,
      source: "app",
    }))
  );
  if (evError) console.error("[statusEvents] bulk event insert failed:", evError.message);
  const { error: patchError } = await admin
    .from("leads")
    .update(statusTimestampPatch(to, at))
    .in("id", rows.map((r) => r.id));
  if (patchError) console.error("[statusEvents] bulk lead patch failed:", patchError.message);
}
```

- [ ] **Step 3.4:** Run: `npx vitest run tests/statusEvents.test.ts` → expected: PASS.
- [ ] **Step 3.5:** Commit:

```bash
git add lib/leads/statusEvents.ts tests/statusEvents.test.ts
git commit -m "feat(reports): status-event ledger helper with timestamp mirroring"
```

---

### Task 4: Dual-write wiring in the three status-changing routes

**Files:**
- Modify: `app/api/leads/[id]/route.ts` (PATCH)
- Modify: `app/api/leads/[id]/follow-ups/route.ts` (POST)
- Modify: `app/api/leads/bulk/route.ts` (POST, status branch)

- [ ] **Step 4.1: PATCH route.** Add to imports: `import { recordStatusChange } from "@/lib/leads/statusEvents";`. Inside the existing block `if (parsed.data.status !== undefined && parsed.data.status !== before.status) {`, insert as its FIRST line (before `const newStatus = parsed.data.status;`):

```ts
    await recordStatusChange(admin, { leadId: id, from: before.status, to: parsed.data.status, userId: user.id });
```

- [ ] **Step 4.2: Follow-ups route.** Add the same import plus keep existing ones. Two insertions:

(a) Immediately after the successful `lead_follow_ups` insert (after `if (error) return NextResponse.json({ error: error.message }, { status: 400 });`), set first-touch once:

```ts
  // First follow-up ever = the lead's first touch. Guarded server-side so a
  // concurrent second call cannot overwrite it.
  if (!lead.first_touch_at) {
    await admin
      .from("leads")
      .update({ first_touch_at: fu.created_at })
      .eq("id", id)
      .is("first_touch_at", null);
  }
```

(b) Inside the existing block `if (!leadUpdateError && statusChange && statusChange !== lead.status) {`, insert as its FIRST line:

```ts
    await recordStatusChange(admin, { leadId: id, from: lead.status, to: statusChange, userId: user.id });
```

- [ ] **Step 4.3: Bulk route.** Add to imports: `import { bulkRecordStatusChanges } from "@/lib/leads/statusEvents";`. The route never reads prior statuses, so capture them BEFORE the update — insert directly above `const { error, count } = await admin` `.from("leads")` `.update(update, { count: "exact" })`:

```ts
  // Prior statuses for the ledger (the update itself never reads them).
  let priorStatuses: { id: string; status: string }[] = [];
  if (action === "status") {
    const { data: prior } = await admin
      .from("leads")
      .select("id, status")
      .in("id", ids)
      .is("deleted_at", null);
    priorStatuses = prior ?? [];
  }
```

Then AFTER the update's error handling (right before the `if (action === "archive") {` cleanup block), emit events only for leads that actually changed:

```ts
  if (action === "status" && value) {
    await bulkRecordStatusChanges(
      admin,
      priorStatuses.filter((l) => l.status !== value),
      value,
      user.id
    );
  }
```

- [ ] **Step 4.4:** Run: `npx tsc --noEmit` → clean. Run: `npm test` → PASS. Run: `npm run lint` → clean.
- [ ] **Step 4.5:** Commit:

```bash
git add app/api/leads/[id]/route.ts app/api/leads/[id]/follow-ups/route.ts app/api/leads/bulk/route.ts
git commit -m "feat(reports): dual-write lead status events from all three status-change routes"
```

---

### Task 5: Backfill math (TDD) + runner script

The pure math lives in a plain `.mjs` module so BOTH the node runner (no TS loader) and vitest (allowJs, `@/` alias) can import it.

**Files:**
- Create: `scripts/backfillStatusEvents.lib.mjs` (pure math)
- Create: `scripts/backfill-status-events.mjs` (thin I/O wrapper)
- Test: `tests/backfillStatusEvents.test.ts`

- [ ] **Step 5.1: Write the failing test:**

```ts
import { describe, it, expect } from "vitest";
import { deriveStatusHistory } from "@/scripts/backfillStatusEvents.lib.mjs";

const row = (p: Record<string, unknown>) => ({
  user_id: "u1", action: "lead.status_changed", entity_id: "L1",
  old_value: null, new_value: null, created_at: "2026-01-01T00:00:00Z", ...p,
});

describe("deriveStatusHistory", () => {
  it("builds events from status_changed rows using old/new values", () => {
    const { events } = deriveStatusHistory({
      activityRows: [
        row({ old_value: { status: "Not Ready" }, new_value: { status: "Ready" }, created_at: "2026-01-02T00:00:00Z" }),
        row({ old_value: { status: "Ready" }, new_value: { status: "Closed" }, created_at: "2026-01-05T00:00:00Z" }),
      ],
      leads: [{ id: "L1", status: "Closed", updated_at: "2026-01-05T00:00:00Z" }],
      followUps: [],
    });
    expect(events).toEqual([
      expect.objectContaining({ lead_id: "L1", from_status: "Not Ready", to_status: "Ready", changed_at: "2026-01-02T00:00:00Z", source: "backfill" }),
      expect.objectContaining({ lead_id: "L1", from_status: "Ready", to_status: "Closed", changed_at: "2026-01-05T00:00:00Z", changed_by: "u1" }),
    ]);
  });

  it("reads lead.updated rows only when the diff contains status, and dedupes no-ops", () => {
    const { events } = deriveStatusHistory({
      activityRows: [
        row({ action: "lead.updated", new_value: { status: "Ready", rating: 5 }, old_value: { status: "Not Ready", rating: 2 } }),
        row({ action: "lead.updated", new_value: { rating: 7 }, old_value: { rating: 5 }, created_at: "2026-01-03T00:00:00Z" }),
        row({ action: "lead.updated", new_value: { status: "Ready" }, old_value: { status: "Ready" }, created_at: "2026-01-04T00:00:00Z" }),
      ],
      leads: [{ id: "L1", status: "Ready", updated_at: "2026-01-04T00:00:00Z" }],
      followUps: [],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ to_status: "Ready", from_status: "Not Ready" });
  });

  it("fans out bulk rows per id, carrying each lead's last known status", () => {
    const { events } = deriveStatusHistory({
      activityRows: [
        row({ old_value: { status: "Not Ready" }, new_value: { status: "Ready" } }),
        row({ action: "lead.bulk_status", entity_id: null, new_value: { ids: ["L1", "L2"], value: "Dropped" }, created_at: "2026-01-06T00:00:00Z" }),
      ],
      leads: [
        { id: "L1", status: "Dropped", updated_at: "2026-01-06T00:00:00Z" },
        { id: "L2", status: "Dropped", updated_at: "2026-01-06T00:00:00Z" },
      ],
      followUps: [],
    });
    expect(events).toHaveLength(3);
    expect(events[1]).toMatchObject({ lead_id: "L1", from_status: "Ready", to_status: "Dropped" });
    expect(events[2]).toMatchObject({ lead_id: "L2", from_status: null, to_status: "Dropped" });
  });

  it("synthesizes an approx event for terminal leads with no log trace", () => {
    const { events, patches } = deriveStatusHistory({
      activityRows: [],
      leads: [{ id: "L9", status: "Closed", updated_at: "2025-12-31T00:00:00Z" }],
      followUps: [],
    });
    expect(events).toEqual([
      expect.objectContaining({ lead_id: "L9", from_status: null, to_status: "Closed", changed_at: "2025-12-31T00:00:00Z", changed_by: null, source: "backfill_approx" }),
    ]);
    expect(patches).toEqual([
      { id: "L9", closed_at: "2025-12-31T00:00:00Z", dropped_at: null, first_touch_at: null },
    ]);
  });

  it("patches closed_at from the LAST entry into the current status, and first_touch_at from the earliest follow-up", () => {
    const { patches } = deriveStatusHistory({
      activityRows: [
        row({ old_value: { status: "Ready" }, new_value: { status: "Closed" }, created_at: "2026-01-05T00:00:00Z" }),
        row({ old_value: { status: "Closed" }, new_value: { status: "Ready" }, created_at: "2026-02-01T00:00:00Z" }),
        row({ old_value: { status: "Ready" }, new_value: { status: "Closed" }, created_at: "2026-03-01T00:00:00Z" }),
      ],
      leads: [
        { id: "L1", status: "Closed", updated_at: "2026-03-01T00:00:00Z" },
        { id: "L2", status: "Ready", updated_at: "2026-01-01T00:00:00Z" },
      ],
      followUps: [
        { lead_id: "L1", created_at: "2026-01-03T00:00:00Z" },
        { lead_id: "L1", created_at: "2026-01-02T00:00:00Z" },
        { lead_id: "L2", created_at: "2026-01-04T00:00:00Z" },
      ],
    });
    expect(patches).toEqual(
      expect.arrayContaining([
        { id: "L1", closed_at: "2026-03-01T00:00:00Z", dropped_at: null, first_touch_at: "2026-01-02T00:00:00Z" },
        { id: "L2", closed_at: null, dropped_at: null, first_touch_at: "2026-01-04T00:00:00Z" },
      ])
    );
  });

  it("emits no patch for untouched open leads", () => {
    const { patches } = deriveStatusHistory({
      activityRows: [],
      leads: [{ id: "L3", status: "Not Ready", updated_at: "2026-01-01T00:00:00Z" }],
      followUps: [],
    });
    expect(patches).toEqual([]);
  });
});
```

- [ ] **Step 5.2:** Run: `npx vitest run tests/backfillStatusEvents.test.ts` → expected: FAIL (module not found).
- [ ] **Step 5.3: Implement `scripts/backfillStatusEvents.lib.mjs`:**

```js
// Pure reconstruction of lead status history from activity_log rows.
// Imported by scripts/backfill-status-events.mjs (node) AND unit tests (vitest).
// Inputs:
//   activityRows: { user_id, action, entity_id, old_value, new_value, created_at }[]
//     sorted ascending by created_at; actions limited to lead.status_changed /
//     lead.updated / lead.bulk_status.
//   leads:     { id, status, updated_at }[]  (every lead, incl. soft-deleted)
//   followUps: { lead_id, created_at }[]
// Output:
//   events:  rows for lead_status_events (source backfill | backfill_approx)
//   patches: { id, closed_at, dropped_at, first_touch_at }[] — only leads
//            where at least one field is non-null.

export function deriveStatusHistory({ activityRows, leads, followUps }) {
  const events = [];
  const byLead = new Map(); // lead_id -> events for that lead, chronological
  const lastStatus = new Map(); // lead_id -> last known status

  const push = (leadId, to, from, userId, at, source) => {
    if (!leadId || to == null) return;
    if (lastStatus.get(leadId) === to) return; // no-op transition
    const ev = {
      lead_id: leadId,
      from_status: from !== undefined ? from : lastStatus.get(leadId) ?? null,
      to_status: to,
      changed_by: userId ?? null,
      changed_at: at,
      source,
    };
    events.push(ev);
    if (!byLead.has(leadId)) byLead.set(leadId, []);
    byLead.get(leadId).push(ev);
    lastStatus.set(leadId, to);
  };

  for (const r of activityRows) {
    if (r.action === "lead.status_changed" || r.action === "lead.updated") {
      const to = r.new_value?.status;
      if (to === undefined) continue; // lead.updated without a status change
      const from = r.old_value && "status" in r.old_value ? r.old_value.status : undefined;
      push(r.entity_id, to, from, r.user_id, r.created_at, "backfill");
    } else if (r.action === "lead.bulk_status") {
      const ids = Array.isArray(r.new_value?.ids) ? r.new_value.ids : [];
      for (const id of ids) push(id, r.new_value?.value, undefined, r.user_id, r.created_at, "backfill");
    }
  }

  const firstTouch = new Map();
  for (const f of followUps) {
    const cur = firstTouch.get(f.lead_id);
    if (!cur || f.created_at < cur) firstTouch.set(f.lead_id, f.created_at);
  }

  const patches = [];
  for (const l of leads) {
    let terminalAt = null;
    if (l.status === "Closed" || l.status === "Dropped") {
      const evs = byLead.get(l.id) ?? [];
      for (let i = evs.length - 1; i >= 0; i--) {
        if (evs[i].to_status === l.status) { terminalAt = evs[i].changed_at; break; }
      }
      if (!terminalAt) {
        // Legacy/imported lead with no trace: approximate from updated_at.
        const ev = {
          lead_id: l.id, from_status: null, to_status: l.status,
          changed_by: null, changed_at: l.updated_at, source: "backfill_approx",
        };
        events.push(ev);
        terminalAt = l.updated_at;
      }
    }
    const patch = {
      id: l.id,
      closed_at: l.status === "Closed" ? terminalAt : null,
      dropped_at: l.status === "Dropped" ? terminalAt : null,
      first_touch_at: firstTouch.get(l.id) ?? null,
    };
    if (patch.closed_at || patch.dropped_at || patch.first_touch_at) patches.push(patch);
  }

  return { events, patches };
}
```

- [ ] **Step 5.4:** Run: `npx vitest run tests/backfillStatusEvents.test.ts` → expected: PASS.
- [ ] **Step 5.5: Write the runner `scripts/backfill-status-events.mjs`:**

```js
// One-time backfill of lead_status_events + leads.closed_at/dropped_at/first_touch_at.
// Idempotent: deletes source like 'backfill%' rows first; never touches 'app' rows.
// Run AFTER migration 0065 is applied and the dual-write code is deployed:
//   node --env-file=.env.local scripts/backfill-status-events.mjs
import { createClient } from "@supabase/supabase-js";
import { deriveStatusHistory } from "./backfillStatusEvents.lib.mjs";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const PAGE = 1000;

async function fetchAll(build) {
  const rows = [];
  for (let fromIdx = 0; ; fromIdx += PAGE) {
    const { data, error } = await build().range(fromIdx, fromIdx + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

const activityRows = await fetchAll(() =>
  admin
    .from("activity_log")
    .select("user_id, action, entity_id, old_value, new_value, created_at")
    .in("action", ["lead.status_changed", "lead.updated", "lead.bulk_status"])
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
);
const leads = await fetchAll(() =>
  admin.from("leads").select("id, status, updated_at").order("id", { ascending: true })
);
const followUps = await fetchAll(() =>
  admin.from("lead_follow_ups").select("lead_id, created_at").order("id", { ascending: true })
);
console.log(`inputs: ${activityRows.length} log rows, ${leads.length} leads, ${followUps.length} follow-ups`);

const { events, patches } = deriveStatusHistory({ activityRows, leads, followUps });
console.log(`derived: ${events.length} events, ${patches.length} lead patches`);

const { error: delError } = await admin
  .from("lead_status_events")
  .delete()
  .like("source", "backfill%");
if (delError) throw new Error(`cleanup failed: ${delError.message}`);

for (let i = 0; i < events.length; i += 500) {
  const { error } = await admin.from("lead_status_events").insert(events.slice(i, i + 500));
  if (error) throw new Error(`event insert failed at ${i}: ${error.message}`);
}

let patched = 0;
for (let i = 0; i < patches.length; i += 20) {
  await Promise.all(
    patches.slice(i, i + 20).map(async ({ id, ...fields }) => {
      const { error } = await admin.from("leads").update(fields).eq("id", id);
      if (error) throw new Error(`lead patch failed for ${id}: ${error.message}`);
      patched++;
    })
  );
}
console.log(`done: ${events.length} events inserted, ${patched} leads patched`);
```

- [ ] **Step 5.6:** Run: `npm test` → all PASS (runner is I/O-only, not unit-tested). Commit:

```bash
git add scripts/backfillStatusEvents.lib.mjs scripts/backfill-status-events.mjs tests/backfillStatusEvents.test.ts
git commit -m "feat(reports): activity_log backfill for the status-event ledger"
```

---

### Task 6: Dashboard velocity KPIs (TDD) + wiring

**Files:**
- Modify: `lib/dashboard/metrics.ts` (new `computeVelocityKpis`)
- Modify: `lib/dashboard/visibility.ts` (4 flags)
- Modify: `components/dashboard/StatGrid.tsx` (4 tiles + `velocity` prop)
- Modify: `components/dashboard/DashboardBoard.tsx` (compute + pass)
- Test: `tests/velocityKpis.test.ts`

- [ ] **Step 6.1: Write the failing test** (`tests/velocityKpis.test.ts`) — reuse the exact `lead()` factory shape from `tests/dashboardMetrics.test.ts` (copy it verbatim, including the three new null fields):

```ts
import { describe, it, expect } from "vitest";
import { computeVelocityKpis } from "@/lib/dashboard/metrics";
import type { Lead } from "@/lib/leads/types";

function lead(p: Partial<Lead>): Lead {
  /* copy the full defaults object from tests/dashboardMetrics.test.ts verbatim,
     then `...p` — it already includes closed_at/dropped_at/first_touch_at: null
     after Task 2. */
}

describe("computeVelocityKpis", () => {
  it("scopes closes and drops by their OWN timestamps, not created_at", () => {
    const leads = [
      lead({ created_at: "2026-06-01T00:00:00Z", closed_at: "2026-07-10T00:00:00Z", status: "Closed" }),
      lead({ created_at: "2026-07-05T00:00:00Z", dropped_at: "2026-07-06T00:00:00Z", status: "Dropped" }),
      lead({ created_at: "2026-07-20T00:00:00Z", closed_at: "2026-08-02T00:00:00Z", status: "Closed" }), // closed in Aug
    ];
    const k = computeVelocityKpis(leads, "2026-07");
    expect(k.closedInPeriod).toBe(1);
    expect(k.droppedInPeriod).toBe(1);
    expect(k.avgTimeToCloseDays).toBeCloseTo(39, 0); // Jun 1 → Jul 10
    expect(k.dropRatio).toBeCloseTo(50, 5);
  });

  it("month '' means all-time", () => {
    const leads = [
      lead({ closed_at: "2026-07-10T00:00:00Z", created_at: "2026-07-01T00:00:00Z" }),
      lead({ closed_at: "2026-08-10T00:00:00Z", created_at: "2026-08-01T00:00:00Z" }),
    ];
    expect(computeVelocityKpis(leads, "").closedInPeriod).toBe(2);
  });

  it("first-touch averages over the ARRIVAL cohort and is null-safe", () => {
    const leads = [
      lead({ created_at: "2026-07-01T00:00:00Z", first_touch_at: "2026-07-01T06:00:00Z" }),
      lead({ created_at: "2026-07-02T00:00:00Z", first_touch_at: "2026-07-02T18:00:00Z" }),
      lead({ created_at: "2026-06-15T00:00:00Z", first_touch_at: "2026-07-01T00:00:00Z" }), // arrived in June — excluded
      lead({ created_at: "2026-07-03T00:00:00Z" }), // untouched — excluded
    ];
    const k = computeVelocityKpis(leads, "2026-07");
    expect(k.avgFirstTouchHours).toBeCloseTo(12, 5);
    expect(computeVelocityKpis([], "2026-07")).toEqual({
      closedInPeriod: 0, droppedInPeriod: 0, avgTimeToCloseDays: null, dropRatio: null, avgFirstTouchHours: null,
    });
  });
});
```

- [ ] **Step 6.2:** Run: `npx vitest run tests/velocityKpis.test.ts` → FAIL (`computeVelocityKpis` not exported).
- [ ] **Step 6.3: Implement in `lib/dashboard/metrics.ts`.** Add to imports: `import { inMonth } from "@/lib/analytics/dateScope";`. Append at the end of the file:

```ts
export interface VelocityKpis {
  closedInPeriod: number;
  droppedInPeriod: number;
  avgTimeToCloseDays: number | null;
  dropRatio: number | null; // % of decided (closed+dropped) that were dropped
  avgFirstTouchHours: number | null;
}

/**
 * Time-aware KPIs over the lifecycle columns. Unlike the other cards, these
 * scope by closed_at/dropped_at (real exit moments) — so callers must pass
 * leads filtered by region+agent but NOT by created_at month; the month is
 * applied here to the correct timestamp per metric.
 */
export function computeVelocityKpis(leads: Lead[], month: string): VelocityKpis {
  const days = (a: string, b: string) => (new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

  const closed = leads.filter((l) => l.closed_at && inMonth(l.closed_at, month));
  const dropped = leads.filter((l) => l.dropped_at && inMonth(l.dropped_at, month));
  const closeDays = closed
    .map((l) => days(l.closed_at as string, l.created_at))
    .filter((d) => d >= 0);
  const decided = closed.length + dropped.length;

  const touched = leads.filter((l) => l.first_touch_at && inMonth(l.created_at, month));
  const touchHours = touched
    .map((l) => days(l.first_touch_at as string, l.created_at) * 24)
    .filter((h) => h >= 0);

  return {
    closedInPeriod: closed.length,
    droppedInPeriod: dropped.length,
    avgTimeToCloseDays: avg(closeDays),
    dropRatio: decided ? (dropped.length / decided) * 100 : null,
    avgFirstTouchHours: avg(touchHours),
  };
}
```

- [ ] **Step 6.4:** Run: `npx vitest run tests/velocityKpis.test.ts` → PASS.
- [ ] **Step 6.5: Visibility flags.** In `lib/dashboard/visibility.ts`: add to `DashboardVisibility` after `avgResolutionTime: boolean;`:

```ts
  closedInPeriod: boolean;
  avgTimeToClose: boolean;
  dropRatio: boolean;
  avgFirstTouch: boolean;
```

and to `KEYMAP` after the `avgResolutionTime` tuple:

```ts
  ["closedInPeriod", "dashboard.kpi.closed_in_period"],
  ["avgTimeToClose", "dashboard.kpi.avg_time_to_close"],
  ["dropRatio", "dashboard.kpi.drop_ratio"],
  ["avgFirstTouch", "dashboard.kpi.avg_first_touch"],
```

- [ ] **Step 6.6: StatGrid tiles.** In `components/dashboard/StatGrid.tsx`: extend the signature and imports —

```ts
import { type ExtendedKpis, type VelocityKpis } from "@/lib/dashboard/metrics";
// ...
export function StatGrid({ kpis, velocity, show }: { kpis: ExtendedKpis; velocity: VelocityKpis; show: DashboardVisibility }) {
```

add next to `fmtHours`:

```ts
const fmtDays = (d: number | null) =>
  d === null ? "—" : d < 2 ? `${Math.round(d * 24)}h` : `${d.toFixed(1)}d`;
```

and append to the `tiles` array (before the closing `];`):

```ts
    {
      key: "closedInPeriod",
      show: show.closedInPeriod,
      label: "Closed (Period)",
      value: String(velocity.closedInPeriod),
      sub: "by close date",
    },
    {
      key: "avgTimeToClose",
      show: show.avgTimeToClose,
      label: "Avg Time To Close",
      value: fmtDays(velocity.avgTimeToCloseDays),
      sub: "arrival → close",
    },
    {
      key: "dropRatio",
      show: show.dropRatio,
      label: "Drop Ratio",
      value: velocity.dropRatio === null ? "—" : `${velocity.dropRatio.toFixed(0)}%`,
      sub: "of decided leads",
    },
    {
      key: "avgFirstTouch",
      show: show.avgFirstTouch,
      label: "Avg First Touch",
      value: fmtHours(velocity.avgFirstTouchHours),
      sub: "arrival → first call",
    },
```

- [ ] **Step 6.7: DashboardBoard.** Add `computeVelocityKpis` to the existing `@/lib/dashboard/metrics` import. After the line `const ext = computeExtendedKpis(fLeads, fFollowUps, fTickets, new Date(now));` add:

```ts
  // Velocity KPIs scope by closed_at/dropped_at, so they get region+agent
  // filtering but NOT the created_at month filter — the month is applied
  // internally to the right timestamp.
  const fLeadsAllTime = useMemo(
    () => filterLeadsByRegions(leads, selSet).filter((l) => !agentId || l.agent_id === agentId),
    [leads, selSet, agentId]
  );
  const velocity = computeVelocityKpis(fLeadsAllTime, month);
```

and change the render call to `<StatGrid kpis={ext} velocity={velocity} show={flags} />`.

- [ ] **Step 6.8:** Run: `npx tsc --noEmit` → clean; `npm test` → PASS; `npm run lint` → clean.
- [ ] **Step 6.9:** Commit:

```bash
git add lib/dashboard/metrics.ts lib/dashboard/visibility.ts components/dashboard/StatGrid.tsx components/dashboard/DashboardBoard.tsx tests/velocityKpis.test.ts
git commit -m "feat(dashboard): velocity KPI cards — closed in period, time to close, drop ratio, first touch"
```

---

### Task 7: Report math module (TDD)

**Files:**
- Create: `lib/reports/agentPeriodicMath.ts` (pure — no I/O)
- Test: `tests/agentPeriodicMath.test.ts`

- [ ] **Step 7.1: Write the failing test:**

```ts
import { describe, it, expect } from "vitest";
import {
  computeWindowMetrics,
  regionRows,
  windowFor,
  type ReportWindow,
} from "@/lib/reports/agentPeriodicMath";
import type { Lead } from "@/lib/leads/types";

function lead(p: Partial<Lead>): Lead {
  /* same full factory as tests/velocityKpis.test.ts (copy verbatim) */
}

const W: ReportWindow = windowFor("2026-07-01", "2026-07-31");
const NO_APPROX = new Set<string>();

describe("windowFor", () => {
  it("builds a half-open UTC window and an equal-length previous window", () => {
    expect(W.fromMs).toBe(Date.parse("2026-07-01T00:00:00Z"));
    expect(W.toExMs).toBe(Date.parse("2026-08-01T00:00:00Z"));
    expect(W.prev.toExMs).toBe(W.fromMs);
    expect(W.prev.toExMs - W.prev.fromMs).toBe(W.toExMs - W.fromMs);
  });
});

describe("computeWindowMetrics", () => {
  it("classifies arrivals, closes, drops, and fresh vs carry-over", () => {
    const leads = [
      lead({ id: "a", created_at: "2026-07-03T00:00:00Z", closed_at: "2026-07-10T00:00:00Z" }), // fresh close
      lead({ id: "b", created_at: "2026-05-01T00:00:00Z", closed_at: "2026-07-20T00:00:00Z" }), // carry-over close
      lead({ id: "c", created_at: "2026-07-04T00:00:00Z", dropped_at: "2026-07-05T00:00:00Z" }), // fast drop (1d)
      lead({ id: "d", created_at: "2026-06-01T00:00:00Z", dropped_at: "2026-07-15T00:00:00Z" }), // slow drop (44d)
      lead({ id: "e", created_at: "2026-07-28T00:00:00Z" }), // open
      lead({ id: "f", created_at: "2026-08-02T00:00:00Z" }), // next month — not arrived
    ];
    const m = computeWindowMetrics(leads, [], [], W, NO_APPROX);
    expect(m.arrived).toBe(4);
    expect(m.closedCount).toBe(2);
    expect(m.closedFresh).toBe(1);
    expect(m.closedCarryOver).toBe(1);
    expect(m.droppedCount).toBe(2);
    expect(m.fastDrops).toBe(1);
    expect(m.slowDrops).toBe(1);
    expect(m.closeRatio).toBeCloseTo(50, 5);
    expect(m.dropRatio).toBeCloseTo(50, 5);
  });

  it("computes avg AND median close days plus distribution buckets", () => {
    const leads = [
      lead({ created_at: "2026-07-01T00:00:00Z", closed_at: "2026-07-02T00:00:00Z" }), // 1d
      lead({ created_at: "2026-07-01T00:00:00Z", closed_at: "2026-07-06T00:00:00Z" }), // 5d
      lead({ created_at: "2026-05-01T00:00:00Z", closed_at: "2026-07-10T00:00:00Z" }), // 70d
    ];
    const m = computeWindowMetrics(leads, [], [], W, NO_APPROX);
    expect(m.medianCloseDays).toBeCloseTo(5, 5);
    expect(m.avgCloseDays).toBeCloseTo((1 + 5 + 70) / 3, 5);
    expect(m.closeBuckets).toEqual({ le1: 1, le3: 0, le7: 1, le14: 0, le30: 0, gt30: 1 });
  });

  it("open-at-end aging uses period end, and excludes leads that exited before it", () => {
    const m = computeWindowMetrics(
      [
        lead({ created_at: "2026-07-29T00:00:00Z" }), // 3d old at end
        lead({ created_at: "2026-07-10T00:00:00Z" }), // 22d
        lead({ created_at: "2026-04-01T00:00:00Z" }), // 122d
        lead({ created_at: "2026-06-01T00:00:00Z", closed_at: "2026-07-20T00:00:00Z" }), // exited
      ],
      [], [], W, NO_APPROX
    );
    expect(m.openAtEnd).toBe(3);
    expect(m.openAging).toEqual({ d0_7: 1, d8_30: 1, d30p: 1 });
  });

  it("revenue counts only closed-in-window leads; ratios and averages are null-safe", () => {
    const m = computeWindowMetrics(
      [
        lead({ created_at: "2026-07-01T00:00:00Z", closed_at: "2026-07-05T00:00:00Z", price_quoted: 900, yearly_price: "120" }),
        lead({ created_at: "2026-07-01T00:00:00Z", price_quoted: 500 }), // open — excluded
      ],
      [{ user_id: "u", fu_status: "Pickup", created_at: "2026-07-02T00:00:00Z" }],
      [{ created_by: "u", sent_at: "2026-07-03T00:00:00Z" }],
      W, NO_APPROX
    );
    expect(m.closedRevenue).toBe(900);
    expect(m.recurringRevenue).toBe(120);
    expect(m.pickupRate).toBeCloseTo(100, 5);
    expect(m.contractsSent).toBe(1);
    const empty = computeWindowMetrics([], [], [], W, NO_APPROX);
    expect(empty.closeRatio).toBeNull();
    expect(empty.avgCloseDays).toBeNull();
    expect(empty.pickupRate).toBeNull();
    expect(empty.contractToCloseRatio).toBeNull();
  });

  it("flags approximate exits", () => {
    const m = computeWindowMetrics(
      [lead({ id: "x", created_at: "2026-01-01T00:00:00Z", closed_at: "2026-07-05T00:00:00Z" })],
      [], [], W, new Set(["x"])
    );
    expect(m.approxCount).toBe(1);
  });
});

describe("regionRows", () => {
  it("groups closes/drops by phone-derived state with Unknown fallback", () => {
    const rows = regionRows(
      [
        lead({ business_phone: "(212) 555-0100", created_at: "2026-07-01T00:00:00Z", closed_at: "2026-07-04T00:00:00Z" }), // NY, 3d
        lead({ business_phone: "(212) 555-0111", created_at: "2026-07-01T00:00:00Z", dropped_at: "2026-07-02T00:00:00Z" }), // NY
        lead({ business_phone: null, created_at: "2026-07-01T00:00:00Z", closed_at: "2026-07-10T00:00:00Z" }), // Unknown
      ],
      W
    );
    const ny = rows.find((r) => r.region === "New York");
    expect(ny).toMatchObject({ closed: 1, dropped: 1 });
    expect(ny?.medianCloseDays).toBeCloseTo(3, 5);
    expect(rows.find((r) => r.region === "Unknown")?.closed).toBe(1);
  });
});
```

- [ ] **Step 7.2:** Run: `npx vitest run tests/agentPeriodicMath.test.ts` → FAIL (module not found).
- [ ] **Step 7.3: Implement `lib/reports/agentPeriodicMath.ts`:**

```ts
import type { Lead } from "@/lib/leads/types";
import { leadRegion } from "@/lib/geo/regions";

export const FAST_DROP_DAYS = 7;
const DAY_MS = 86_400_000;

export interface ReportWindow {
  fromMs: number;
  toExMs: number; // exclusive
  prev: { fromMs: number; toExMs: number };
}

export interface FollowUpRow { user_id: string | null; fu_status: string; created_at: string }
export interface ContractLite { created_by?: string | null; sent_at: string | null }

export interface WindowMetrics {
  arrived: number;
  closedCount: number;
  droppedCount: number;
  closedFresh: number;
  closedCarryOver: number;
  openAtEnd: number;
  openAging: { d0_7: number; d8_30: number; d30p: number };
  avgCloseDays: number | null;
  medianCloseDays: number | null;
  avgDropDays: number | null;
  medianDropDays: number | null;
  avgFirstTouchHours: number | null;
  medianFirstTouchHours: number | null;
  closeBuckets: { le1: number; le3: number; le7: number; le14: number; le30: number; gt30: number };
  fastDrops: number;
  slowDrops: number;
  closeRatio: number | null; // % of decided that closed
  dropRatio: number | null;  // % of decided that dropped
  followUpsLogged: number;
  pickupRate: number | null;
  contractsSent: number;
  contractToCloseRatio: number | null; // closes per contract sent
  closedRevenue: number;
  recurringRevenue: number;
  avgDealSize: number | null; // over closed-in-window priced leads
  approxCount: number; // exits whose timestamp is backfill-approximated
}

export interface RegionRow {
  region: string;
  closed: number;
  dropped: number;
  medianCloseDays: number | null;
}

const ms = (iso: string) => new Date(iso).getTime();
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** "YYYY-MM-DD" × 2 → half-open UTC window plus equal-length previous window. */
export function windowFor(from: string, to: string): ReportWindow {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toExMs = Date.parse(`${to}T00:00:00Z`) + DAY_MS;
  const len = toExMs - fromMs;
  return { fromMs, toExMs, prev: { fromMs: fromMs - len, toExMs: fromMs } };
}

const inWindow = (iso: string | null | undefined, w: { fromMs: number; toExMs: number }) =>
  !!iso && ms(iso) >= w.fromMs && ms(iso) < w.toExMs;

const closeDaysOf = (ls: Lead[]) =>
  ls.map((l) => (ms(l.closed_at as string) - ms(l.created_at)) / DAY_MS).filter((d) => d >= 0);

export function computeWindowMetrics(
  leads: Lead[],            // ownership-scoped: one agent's leads, or the whole team's
  followUps: FollowUpRow[], // actor-scoped the same way
  contracts: ContractLite[],
  w: { fromMs: number; toExMs: number },
  approxLeadIds: Set<string>
): WindowMetrics {
  const arrived = leads.filter((l) => inWindow(l.created_at, w));
  const closedL = leads.filter((l) => inWindow(l.closed_at, w));
  const droppedL = leads.filter((l) => inWindow(l.dropped_at, w));

  const closeDays = closeDaysOf(closedL);
  const dropDays = droppedL
    .map((l) => (ms(l.dropped_at as string) - ms(l.created_at)) / DAY_MS)
    .filter((d) => d >= 0);
  const touchHours = arrived
    .filter((l) => l.first_touch_at)
    .map((l) => (ms(l.first_touch_at as string) - ms(l.created_at)) / 3_600_000)
    .filter((h) => h >= 0);

  const openLeads = leads.filter(
    (l) =>
      ms(l.created_at) < w.toExMs &&
      !(l.closed_at && ms(l.closed_at) < w.toExMs) &&
      !(l.dropped_at && ms(l.dropped_at) < w.toExMs)
  );
  const openAging = { d0_7: 0, d8_30: 0, d30p: 0 };
  for (const l of openLeads) {
    const age = (w.toExMs - ms(l.created_at)) / DAY_MS;
    if (age <= 7) openAging.d0_7++;
    else if (age <= 30) openAging.d8_30++;
    else openAging.d30p++;
  }

  const closeBuckets = { le1: 0, le3: 0, le7: 0, le14: 0, le30: 0, gt30: 0 };
  for (const d of closeDays) {
    if (d <= 1) closeBuckets.le1++;
    else if (d <= 3) closeBuckets.le3++;
    else if (d <= 7) closeBuckets.le7++;
    else if (d <= 14) closeBuckets.le14++;
    else if (d <= 30) closeBuckets.le30++;
    else closeBuckets.gt30++;
  }

  const decided = closedL.length + droppedL.length;
  const fu = followUps.filter((f) => inWindow(f.created_at, w));
  const pickups = fu.filter((f) => f.fu_status === "Pickup").length;
  const contractsSent = contracts.filter((c) => inWindow(c.sent_at, w)).length;

  const prices = closedL.map((l) => num(l.price_quoted)).filter((n): n is number => n !== null);

  return {
    arrived: arrived.length,
    closedCount: closedL.length,
    droppedCount: droppedL.length,
    closedFresh: closedL.filter((l) => inWindow(l.created_at, w)).length,
    closedCarryOver: closedL.filter((l) => !inWindow(l.created_at, w)).length,
    openAtEnd: openLeads.length,
    openAging,
    avgCloseDays: avg(closeDays),
    medianCloseDays: median(closeDays),
    avgDropDays: avg(dropDays),
    medianDropDays: median(dropDays),
    avgFirstTouchHours: avg(touchHours),
    medianFirstTouchHours: median(touchHours),
    closeBuckets,
    fastDrops: dropDays.filter((d) => d <= FAST_DROP_DAYS).length,
    slowDrops: dropDays.filter((d) => d > FAST_DROP_DAYS).length,
    closeRatio: decided ? (closedL.length / decided) * 100 : null,
    dropRatio: decided ? (droppedL.length / decided) * 100 : null,
    followUpsLogged: fu.length,
    pickupRate: fu.length ? (pickups / fu.length) * 100 : null,
    contractsSent,
    contractToCloseRatio: contractsSent ? closedL.length / contractsSent : null,
    closedRevenue: prices.reduce((s, n) => s + n, 0),
    recurringRevenue: closedL.reduce((s, l) => s + (num(l.yearly_price) ?? 0), 0),
    avgDealSize: avg(prices),
    approxCount: [...closedL, ...droppedL].filter((l) => approxLeadIds.has(l.id)).length,
  };
}

/** Regional exits within the window, sorted by activity desc, Unknown last. */
export function regionRows(leads: Lead[], w: { fromMs: number; toExMs: number }): RegionRow[] {
  const by = new Map<string, Lead[]>();
  for (const l of leads) {
    if (!inWindow(l.closed_at, w) && !inWindow(l.dropped_at, w)) continue;
    const r = leadRegion(l);
    if (!by.has(r)) by.set(r, []);
    by.get(r)!.push(l);
  }
  return [...by.entries()]
    .map(([region, ls]) => {
      const closed = ls.filter((l) => inWindow(l.closed_at, w));
      return {
        region,
        closed: closed.length,
        dropped: ls.filter((l) => inWindow(l.dropped_at, w)).length,
        medianCloseDays: median(closeDaysOf(closed)),
      };
    })
    .sort((a, b) =>
      a.region === "Unknown" ? 1 : b.region === "Unknown" ? -1 : b.closed + b.dropped - (a.closed + a.dropped)
    );
}
```

- [ ] **Step 7.4:** Run: `npx vitest run tests/agentPeriodicMath.test.ts` → PASS.
- [ ] **Step 7.5:** Commit:

```bash
git add lib/reports/agentPeriodicMath.ts tests/agentPeriodicMath.test.ts
git commit -m "feat(reports): pure window-metrics math for the agent periodic report"
```

---### Task 8: Report builder (I/O) + JSON API route

**Files:**
- Create: `lib/reports/agentPeriodic.ts`
- Create: `app/api/reports/agent/route.ts`

- [ ] **Step 8.1: Implement `lib/reports/agentPeriodic.ts`** (I/O composition — targeted selects, callers have already permission-checked):

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lead } from "@/lib/leads/types";
import { summarize, type SessionRow } from "@/lib/signin/analytics";
import {
  computeWindowMetrics,
  regionRows,
  windowFor,
  type ContractLite,
  type FollowUpRow,
  type RegionRow,
  type ReportWindow,
  type WindowMetrics,
} from "@/lib/reports/agentPeriodicMath";

export interface AgentPeriodicReport {
  agent: { id: string; name: string; active: boolean };
  period: { from: string; to: string };
  metrics: { agent: WindowMetrics; team: WindowMetrics; prev: WindowMetrics };
  regions: { agent: RegionRow[]; team: RegionRow[] };
  generation: { ai: number; template: number; studio: number; builder: number; total: number };
  attendance: { days: number; totalHours: number; avgLateMinutes: number } | null;
}

const iso = (msVal: number) => new Date(msVal).toISOString();

async function generationCount(
  admin: SupabaseClient,
  table: string,
  col: "created_by" | "agent_id",
  agentId: string,
  w: ReportWindow
): Promise<number> {
  const { count } = await admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(col, agentId)
    .gte("created_at", iso(w.fromMs))
    .lt("created_at", iso(w.toExMs));
  return count ?? 0;
}

export async function buildAgentPeriodicReport(
  admin: SupabaseClient,
  opts: { agentId: string; from: string; to: string; includeAttendance: boolean }
): Promise<AgentPeriodicReport | null> {
  const w = windowFor(opts.from, opts.to);

  const [{ data: profile }, { data: leadsData }, { data: fuData }, { data: contractsData }, { data: approxData }] =
    await Promise.all([
      admin.from("profiles").select("id, display_name, is_active").eq("id", opts.agentId).maybeSingle(),
      admin
        .from("leads")
        .select(
          "id, agent_id, status, business_phone, price_quoted, yearly_price, created_at, closed_at, dropped_at, first_touch_at"
        )
        .is("deleted_at", null)
        .not("agent_id", "is", null),
      admin
        .from("lead_follow_ups")
        .select("user_id, fu_status, created_at")
        .gte("created_at", iso(w.prev.fromMs))
        .lt("created_at", iso(w.toExMs)),
      admin
        .from("contracts")
        .select("created_by, sent_at")
        .not("sent_at", "is", null)
        .gte("sent_at", iso(w.prev.fromMs))
        .lt("sent_at", iso(w.toExMs)),
      admin.from("lead_status_events").select("lead_id").eq("source", "backfill_approx"),
    ]);
  if (!profile) return null;

  const leads = (leadsData ?? []) as Lead[];
  const followUps = (fuData ?? []) as FollowUpRow[];
  const contracts = (contractsData ?? []) as ContractLite[];
  const approxIds = new Set((approxData ?? []).map((r) => r.lead_id as string));

  const agentLeads = leads.filter((l) => l.agent_id === opts.agentId);
  const agentFu = followUps.filter((f) => f.user_id === opts.agentId);
  const agentContracts = contracts.filter((c) => c.created_by === opts.agentId);

  const [ai, template, studio, builder] = await Promise.all([
    generationCount(admin, "ai_generations", "agent_id", opts.agentId, w),
    generationCount(admin, "template_generations", "created_by", opts.agentId, w),
    generationCount(admin, "studio_runs", "created_by", opts.agentId, w),
    generationCount(admin, "builder_runs", "created_by", opts.agentId, w),
  ]);

  let attendance: AgentPeriodicReport["attendance"] = null;
  if (opts.includeAttendance) {
    const [{ data: settings }, { data: sessions }] = await Promise.all([
      admin.from("app_settings").select("work_start_time, work_timezone").limit(1).maybeSingle(),
      admin
        .from("user_sessions")
        .select("user_id, signed_in_at, signed_out_at, last_seen_at")
        .eq("user_id", opts.agentId)
        .gte("signed_in_at", iso(w.fromMs))
        .lt("signed_in_at", iso(w.toExMs)),
    ]);
    const { perUserDay } = summarize((sessions ?? []) as SessionRow[], {
      tz: settings?.work_timezone ?? "Asia/Karachi",
      workStart: (settings?.work_start_time ?? "09:00").slice(0, 5),
      now: new Date(w.toExMs),
    });
    const days = perUserDay.filter((d) => d.userId === opts.agentId);
    attendance = {
      days: days.length,
      totalHours: days.reduce((s, d) => s + d.hours, 0),
      avgLateMinutes: days.length ? days.reduce((s, d) => s + d.lateMinutes, 0) / days.length : 0,
    };
  }

  return {
    agent: {
      id: profile.id,
      name: (profile.display_name as string | null) ?? "—",
      active: (profile.is_active as boolean | null) ?? true,
    },
    period: { from: opts.from, to: opts.to },
    metrics: {
      agent: computeWindowMetrics(agentLeads, agentFu, agentContracts, w, approxIds),
      team: computeWindowMetrics(leads, followUps, contracts, w, approxIds),
      prev: computeWindowMetrics(agentLeads, agentFu, agentContracts, w.prev, approxIds),
    },
    regions: { agent: regionRows(agentLeads, w), team: regionRows(leads, w) },
    generation: { ai, template, studio, builder, total: ai + template + studio + builder },
    attendance,
  };
}
```

- [ ] **Step 8.2: Implement `app/api/reports/agent/route.ts`:**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { buildAgentPeriodicReport } from "@/lib/reports/agentPeriodic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const schema = z
  .object({
    agentId: z.string().uuid(),
    from: z.string().regex(DATE),
    to: z.string().regex(DATE),
    includeAttendance: z.boolean().optional().default(false),
  })
  .refine((v) => v.from <= v.to, { message: "from must be on or before to" });

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("reports.agent_periodic")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 422 });
  }

  const admin = createAdminClient();
  const report = await buildAgentPeriodicReport(admin, parsed.data);
  if (!report) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  return NextResponse.json({ report });
}
```

- [ ] **Step 8.3:** Run: `npx tsc --noEmit` → clean; `npm test` → PASS; `npm run lint` → clean.
- [ ] **Step 8.4:** Commit:

```bash
git add lib/reports/agentPeriodic.ts app/api/reports/agent/route.ts
git commit -m "feat(reports): report builder + permission-gated JSON route"
```

---

### Task 9: Report page + client board + sidebar entry

**Files:**
- Create: `app/(app)/reports/agent/page.tsx`
- Create: `components/reports/AgentReportBoard.tsx`
- Modify: `components/layout/Sidebar.tsx`

- [ ] **Step 9.1: Page (server component, standard gate):**

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { AgentReportBoard } from "@/components/reports/AgentReportBoard";

export default async function AgentReportPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const perms = await getUserPermissions(user.id);
  if (!perms.has("reports.agent_periodic")) redirect("/dashboard");

  // Sales roster via the service client (profiles RLS hides other users), and
  // INCLUDING deactivated profiles — historical periods must stay reportable.
  const admin = createAdminClient();
  const { data: salesDept } = await admin.from("departments").select("id").eq("slug", "sales").single();
  const { data: members } = salesDept
    ? await admin
        .from("department_members")
        .select("user_id, profiles!department_members_user_id_fkey(id, display_name, is_active)")
        .eq("department_id", salesDept.id)
    : { data: [] as never[] };
  const salesUsers = (members ?? [])
    .map((m: any) => ({
      id: m.profiles?.id as string,
      display_name: (m.profiles?.display_name as string | null) ?? "—",
      is_active: (m.profiles?.is_active as boolean | null) ?? true,
    }))
    .filter((u) => u.id)
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-text mb-1">Agent Periodic Report</h1>
        <p className="text-sm text-text-muted mb-5">
          Pipeline, velocity, ratios, revenue and regions for one agent vs. the team and their previous period.
        </p>
      </div>
      <AgentReportBoard salesUsers={salesUsers} />
    </div>
  );
}
```

- [ ] **Step 9.2: Client board `components/reports/AgentReportBoard.tsx`.** Repo conventions: `"use client"`, fetch-POST with `.json().catch(() => ({}))` error fallback, card styling `bg-surface border border-border rounded-lg p-5`, stat tile `bg-surface-2 border border-border rounded-md px-3 py-2`:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { AgentPeriodicReport } from "@/lib/reports/agentPeriodic";
import type { WindowMetrics } from "@/lib/reports/agentPeriodicMath";
import { formatCompactCurrency } from "@/lib/leads/format";

type Fmt = (v: number | null) => string;
const fmtInt: Fmt = (v) => (v === null ? "—" : String(Math.round(v)));
const fmtPct: Fmt = (v) => (v === null ? "—" : `${v.toFixed(0)}%`);
const fmtDays: Fmt = (v) => (v === null ? "—" : v < 2 ? `${Math.round(v * 24)}h` : `${v.toFixed(1)}d`);
const fmtHours: Fmt = (v) => (v === null ? "—" : v < 48 ? `${Math.round(v)}h` : `${(v / 24).toFixed(1)}d`);
const fmtMoney: Fmt = (v) => (v === null ? "—" : formatCompactCurrency(v));
const fmtRatio: Fmt = (v) => (v === null ? "—" : v.toFixed(2));

interface RowDef { label: string; get: (m: WindowMetrics) => number | null; fmt: Fmt }

const SECTIONS: { title: string; rows: RowDef[] }[] = [
  {
    title: "Pipeline flow",
    rows: [
      { label: "Leads arrived", get: (m) => m.arrived, fmt: fmtInt },
      { label: "Closed (won)", get: (m) => m.closedCount, fmt: fmtInt },
      { label: "— of which fresh (arrived this period)", get: (m) => m.closedFresh, fmt: fmtInt },
      { label: "— of which carry-over", get: (m) => m.closedCarryOver, fmt: fmtInt },
      { label: "Dropped (lost)", get: (m) => m.droppedCount, fmt: fmtInt },
      { label: "Open at period end", get: (m) => m.openAtEnd, fmt: fmtInt },
      { label: "— open 0–7 days", get: (m) => m.openAging.d0_7, fmt: fmtInt },
      { label: "— open 8–30 days", get: (m) => m.openAging.d8_30, fmt: fmtInt },
      { label: "— open 30+ days", get: (m) => m.openAging.d30p, fmt: fmtInt },
    ],
  },
  {
    title: "Velocity",
    rows: [
      { label: "Median time to close", get: (m) => m.medianCloseDays, fmt: fmtDays },
      { label: "Avg time to close", get: (m) => m.avgCloseDays, fmt: fmtDays },
      { label: "Median time to drop", get: (m) => m.medianDropDays, fmt: fmtDays },
      { label: "Fast drops (≤7d — quick disqualification)", get: (m) => m.fastDrops, fmt: fmtInt },
      { label: "Slow drops (>7d — worked, then lost)", get: (m) => m.slowDrops, fmt: fmtInt },
      { label: "Median first touch", get: (m) => m.medianFirstTouchHours, fmt: fmtHours },
    ],
  },
  {
    title: "Ratios",
    rows: [
      { label: "Close ratio (of decided)", get: (m) => m.closeRatio, fmt: fmtPct },
      { label: "Drop ratio (of decided)", get: (m) => m.dropRatio, fmt: fmtPct },
      { label: "Pickup rate", get: (m) => m.pickupRate, fmt: fmtPct },
      { label: "Follow-ups logged", get: (m) => m.followUpsLogged, fmt: fmtInt },
      { label: "Contracts sent", get: (m) => m.contractsSent, fmt: fmtInt },
      { label: "Closes per contract sent", get: (m) => m.contractToCloseRatio, fmt: fmtRatio },
    ],
  },
  {
    title: "Revenue (by close date, quoted/contracted)",
    rows: [
      { label: "Closed revenue", get: (m) => m.closedRevenue, fmt: fmtMoney },
      { label: "Recurring (yearly)", get: (m) => m.recurringRevenue, fmt: fmtMoney },
      { label: "Avg deal size", get: (m) => m.avgDealSize, fmt: fmtMoney },
    ],
  },
];

const BUCKETS: { key: keyof WindowMetrics["closeBuckets"]; label: string }[] = [
  { key: "le1", label: "≤1d" }, { key: "le3", label: "≤3d" }, { key: "le7", label: "≤7d" },
  { key: "le14", label: "≤14d" }, { key: "le30", label: "≤30d" }, { key: "gt30", label: ">30d" },
];

function monthRange(offset: number): { from: string; to: string; label: string } {
  const d = new Date();
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - offset, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  const s = (x: Date) => x.toISOString().slice(0, 10);
  return {
    from: s(start),
    to: s(end),
    label: start.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

export function AgentReportBoard({
  salesUsers,
}: {
  salesUsers: { id: string; display_name: string; is_active: boolean }[];
}) {
  const presets = useMemo(() => [monthRange(0), monthRange(1), monthRange(2)], []);
  const [agentId, setAgentId] = useState("");
  const [from, setFrom] = useState(presets[0].from);
  const [to, setTo] = useState(presets[0].to);
  const [includeAttendance, setIncludeAttendance] = useState(false);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [report, setReport] = useState<AgentPeriodicReport | null>(null);

  async function generate() {
    if (!agentId) { setApiError("Pick an agent first."); return; }
    setBusy(true);
    setApiError(null);
    const res = await fetch("/api/reports/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, from, to, includeAttendance }),
    });
    setBusy(false);
    if (!res.ok) {
      setApiError((await res.json().catch(() => ({}))).error ?? "Failed to generate report");
      return;
    }
    setReport((await res.json()).report);
  }

  const pdfHref = agentId
    ? `/api/reports/agent/pdf?agentId=${agentId}&from=${from}&to=${to}${includeAttendance ? "&attendance=1" : ""}`
    : null;
  const m = report?.metrics;

  return (
    <div className="space-y-5">
      <div className="bg-surface border border-border rounded-lg p-5 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-[10px] uppercase tracking-wide text-text-faint mb-1">Agent</span>
          <select
            className="bg-surface-2 border border-border rounded-md px-2 py-1.5 text-sm"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            <option value="">Select agent…</option>
            {salesUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name}{u.is_active ? "" : " (deactivated)"}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-[10px] uppercase tracking-wide text-text-faint mb-1">From</span>
          <input type="date" className="bg-surface-2 border border-border rounded-md px-2 py-1.5 text-sm"
            value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="block text-[10px] uppercase tracking-wide text-text-faint mb-1">To</span>
          <input type="date" className="bg-surface-2 border border-border rounded-md px-2 py-1.5 text-sm"
            value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <div className="flex gap-1.5">
          {presets.map((p) => (
            <button key={p.from} type="button"
              className={"text-xs border rounded-md px-2 py-1.5 " +
                (from === p.from && to === p.to ? "border-accent text-accent" : "border-border text-text-muted")}
              onClick={() => { setFrom(p.from); setTo(p.to); }}>
              {p.label}
            </button>
          ))}
        </div>
        <label className="text-xs text-text-muted flex items-center gap-1.5 pb-1.5">
          <input type="checkbox" checked={includeAttendance}
            onChange={(e) => setIncludeAttendance(e.target.checked)} />
          Include attendance
        </label>
        <button type="button" disabled={busy}
          className="bg-accent text-white rounded-md px-4 py-1.5 text-sm disabled:opacity-50"
          onClick={generate}>
          {busy ? "Generating…" : "Generate"}
        </button>
        {report && pdfHref && (
          <a className="text-sm text-accent underline pb-1.5" href={pdfHref}>Download PDF</a>
        )}
      </div>

      {apiError && (
        <div className="bg-surface border border-border rounded-lg p-4 text-sm text-red-500">{apiError}</div>
      )}

      {report && m && (
        <>
          <div className="text-sm text-text-muted">
            {report.agent.name}{report.agent.active ? "" : " (deactivated)"} · {report.period.from} → {report.period.to}
            {m.agent.approxCount > 0 && (
              <span className="ml-2 text-amber-500">
                {m.agent.approxCount} exit timing(s) approximated from legacy data
              </span>
            )}
          </div>

          {SECTIONS.map((s) => (
            <div key={s.title} className="bg-surface border border-border rounded-lg p-5">
              <h2 className="text-sm font-semibold text-text mb-3">{s.title}</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-text-faint text-left">
                    <th className="pb-2 font-normal">Metric</th>
                    <th className="pb-2 font-normal text-right">Agent</th>
                    <th className="pb-2 font-normal text-right">Team</th>
                    <th className="pb-2 font-normal text-right">Prev period</th>
                  </tr>
                </thead>
                <tbody>
                  {s.rows.map((r) => (
                    <tr key={r.label} className="border-t border-border">
                      <td className="py-1.5 text-text-muted">{r.label}</td>
                      <td className="py-1.5 text-right font-mono text-text">{r.fmt(r.get(m.agent))}</td>
                      <td className="py-1.5 text-right font-mono text-text-muted">{r.fmt(r.get(m.team))}</td>
                      <td className="py-1.5 text-right font-mono text-text-muted">{r.fmt(r.get(m.prev))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          <div className="bg-surface border border-border rounded-lg p-5">
            <h2 className="text-sm font-semibold text-text mb-3">Close-time distribution</h2>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              {BUCKETS.map((b) => (
                <div key={b.key} className="bg-surface-2 border border-border rounded-md px-3 py-2">
                  <div className="text-lg font-semibold font-mono">{m.agent.closeBuckets[b.key]}</div>
                  <div className="text-[10px] uppercase tracking-wide text-text-faint">{b.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-surface border border-border rounded-lg p-5">
            <h2 className="text-sm font-semibold text-text mb-3">Regions (agent, this period)</h2>
            {report.regions.agent.length === 0 ? (
              <p className="text-sm text-text-faint">No closes or drops in this period.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-text-faint text-left">
                    <th className="pb-2 font-normal">Region</th>
                    <th className="pb-2 font-normal text-right">Closed</th>
                    <th className="pb-2 font-normal text-right">Dropped</th>
                    <th className="pb-2 font-normal text-right">Median close</th>
                    <th className="pb-2 font-normal text-right">Team median close</th>
                  </tr>
                </thead>
                <tbody>
                  {report.regions.agent.map((r) => {
                    const t = report.regions.team.find((x) => x.region === r.region);
                    return (
                      <tr key={r.region} className="border-t border-border">
                        <td className="py-1.5 text-text-muted">{r.region}</td>
                        <td className="py-1.5 text-right font-mono">{r.closed}</td>
                        <td className="py-1.5 text-right font-mono">{r.dropped}</td>
                        <td className="py-1.5 text-right font-mono">{fmtDays(r.medianCloseDays)}</td>
                        <td className="py-1.5 text-right font-mono text-text-muted">{fmtDays(t?.medianCloseDays ?? null)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="bg-surface border border-border rounded-lg p-5">
            <h2 className="text-sm font-semibold text-text mb-3">Activity</h2>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: "Sites generated", value: report.generation.total },
                { label: "AI tools", value: report.generation.ai },
                { label: "Template engine", value: report.generation.template },
                { label: "Site studio", value: report.generation.studio },
                { label: "Site builder", value: report.generation.builder },
              ].map((t) => (
                <div key={t.label} className="bg-surface-2 border border-border rounded-md px-3 py-2">
                  <div className="text-lg font-semibold font-mono">{t.value}</div>
                  <div className="text-[10px] uppercase tracking-wide text-text-faint">{t.label}</div>
                </div>
              ))}
            </div>
            {report.attendance && (
              <div className="grid grid-cols-3 gap-3 mt-3">
                <div className="bg-surface-2 border border-border rounded-md px-3 py-2">
                  <div className="text-lg font-semibold font-mono">{report.attendance.days}</div>
                  <div className="text-[10px] uppercase tracking-wide text-text-faint">Days signed in</div>
                </div>
                <div className="bg-surface-2 border border-border rounded-md px-3 py-2">
                  <div className="text-lg font-semibold font-mono">{report.attendance.totalHours.toFixed(1)}h</div>
                  <div className="text-[10px] uppercase tracking-wide text-text-faint">Hours online</div>
                </div>
                <div className="bg-surface-2 border border-border rounded-md px-3 py-2">
                  <div className="text-lg font-semibold font-mono">{Math.round(report.attendance.avgLateMinutes)}m</div>
                  <div className="text-[10px] uppercase tracking-wide text-text-faint">Avg late</div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 9.3: Sidebar.** In `components/layout/Sidebar.tsx`: add `ClipboardList` to the existing lucide-react import, and in the `MAIN` array after the `/by-agent` entry add:

```ts
  { href: "/reports/agent", label: "Agent Report", icon: ClipboardList, perm: "reports.agent_periodic" },
```

- [ ] **Step 9.4:** Run: `npx tsc --noEmit` → clean; `npm run lint` → clean; `npm test` → PASS.
- [ ] **Step 9.5:** Commit:

```bash
git add "app/(app)/reports/agent/page.tsx" components/reports/AgentReportBoard.tsx components/layout/Sidebar.tsx
git commit -m "feat(reports): agent periodic report page with period presets and benchmarks"
```

---

### Task 10: PDF export

**Files:**
- Create: `lib/reports/ReportDocument.tsx`
- Create: `app/api/reports/agent/pdf/route.ts`

- [ ] **Step 10.1: `lib/reports/ReportDocument.tsx`** (mirrors ContractDocument conventions: StyleSheet at top, built-in Helvetica fonts, `renderXxxPdf → renderToBuffer`; no images, so the Buffer-image quirk doesn't apply):

```tsx
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { AgentPeriodicReport } from "@/lib/reports/agentPeriodic";
import type { WindowMetrics } from "@/lib/reports/agentPeriodicMath";
import { formatUsd } from "@/lib/contracts/merge";

const HEADING = "#1c2a4a";
const MUTED = "#666";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9.5, fontFamily: "Helvetica", color: "#1a1a1a", lineHeight: 1.4 },
  title: { fontSize: 17, fontFamily: "Helvetica-Bold", color: HEADING, marginBottom: 2 },
  subtitle: { color: MUTED, marginBottom: 14 },
  section: { marginBottom: 12 },
  h2: { fontSize: 11.5, fontFamily: "Helvetica-Bold", color: HEADING, marginBottom: 5 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#dfe3ec", paddingVertical: 2.5 },
  head: { flexDirection: "row", paddingBottom: 3 },
  cLabel: { flex: 3 },
  cVal: { flex: 1, textAlign: "right", fontFamily: "Helvetica-Bold" },
  cMuted: { flex: 1, textAlign: "right", color: MUTED },
  headText: { flex: 1, textAlign: "right", fontSize: 7.5, color: MUTED, textTransform: "uppercase" },
  headLabel: { flex: 3, fontSize: 7.5, color: MUTED, textTransform: "uppercase" },
  note: { color: "#8a6d1a", marginBottom: 10 },
});

type Fmt = (v: number | null) => string;
const fmtInt: Fmt = (v) => (v === null ? "—" : String(Math.round(v)));
const fmtPct: Fmt = (v) => (v === null ? "—" : `${v.toFixed(0)}%`);
const fmtDays: Fmt = (v) => (v === null ? "—" : v < 2 ? `${Math.round(v * 24)}h` : `${v.toFixed(1)}d`);
const fmtHours: Fmt = (v) => (v === null ? "—" : v < 48 ? `${Math.round(v)}h` : `${(v / 24).toFixed(1)}d`);
const fmtRatio: Fmt = (v) => (v === null ? "—" : v.toFixed(2));

interface RowDef { label: string; get: (m: WindowMetrics) => number | null; fmt: Fmt }

const SECTIONS: { title: string; rows: RowDef[] }[] = [
  {
    title: "Pipeline flow",
    rows: [
      { label: "Leads arrived", get: (m) => m.arrived, fmt: fmtInt },
      { label: "Closed (won)", get: (m) => m.closedCount, fmt: fmtInt },
      { label: "Closed — fresh (arrived this period)", get: (m) => m.closedFresh, fmt: fmtInt },
      { label: "Dropped (lost)", get: (m) => m.droppedCount, fmt: fmtInt },
      { label: "Open at period end", get: (m) => m.openAtEnd, fmt: fmtInt },
      { label: "Open 30+ days", get: (m) => m.openAging.d30p, fmt: fmtInt },
    ],
  },
  {
    title: "Velocity",
    rows: [
      { label: "Median time to close", get: (m) => m.medianCloseDays, fmt: fmtDays },
      { label: "Avg time to close", get: (m) => m.avgCloseDays, fmt: fmtDays },
      { label: "Median time to drop", get: (m) => m.medianDropDays, fmt: fmtDays },
      { label: "Fast drops (≤7d)", get: (m) => m.fastDrops, fmt: fmtInt },
      { label: "Slow drops (>7d)", get: (m) => m.slowDrops, fmt: fmtInt },
      { label: "Median first touch", get: (m) => m.medianFirstTouchHours, fmt: fmtHours },
    ],
  },
  {
    title: "Ratios",
    rows: [
      { label: "Close ratio (of decided)", get: (m) => m.closeRatio, fmt: fmtPct },
      { label: "Drop ratio (of decided)", get: (m) => m.dropRatio, fmt: fmtPct },
      { label: "Pickup rate", get: (m) => m.pickupRate, fmt: fmtPct },
      { label: "Follow-ups logged", get: (m) => m.followUpsLogged, fmt: fmtInt },
      { label: "Contracts sent", get: (m) => m.contractsSent, fmt: fmtInt },
      { label: "Closes per contract sent", get: (m) => m.contractToCloseRatio, fmt: fmtRatio },
    ],
  },
  {
    title: "Revenue (by close date, quoted/contracted)",
    rows: [
      { label: "Closed revenue", get: (m) => m.closedRevenue, fmt: (v) => formatUsd(v) },
      { label: "Recurring (yearly)", get: (m) => m.recurringRevenue, fmt: (v) => formatUsd(v) },
      { label: "Avg deal size", get: (m) => m.avgDealSize, fmt: (v) => formatUsd(v) },
    ],
  },
];

export function ReportDocument({ report }: { report: AgentPeriodicReport }) {
  const m = report.metrics;
  return (
    <Document title={`Agent Periodic Report — ${report.agent.name}`}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Agent Periodic Report</Text>
        <Text style={styles.subtitle}>
          {report.agent.name}{report.agent.active ? "" : " (deactivated)"} · {report.period.from} → {report.period.to}
        </Text>
        {m.agent.approxCount > 0 && (
          <Text style={styles.note}>
            Note: {m.agent.approxCount} exit timing(s) approximated from legacy data (pre-ledger).
          </Text>
        )}
        {SECTIONS.map((s) => (
          <View key={s.title} style={styles.section} wrap={false}>
            <Text style={styles.h2}>{s.title}</Text>
            <View style={styles.head}>
              <Text style={styles.headLabel}>Metric</Text>
              <Text style={styles.headText}>Agent</Text>
              <Text style={styles.headText}>Team</Text>
              <Text style={styles.headText}>Prev</Text>
            </View>
            {s.rows.map((r) => (
              <View key={r.label} style={styles.row}>
                <Text style={styles.cLabel}>{r.label}</Text>
                <Text style={styles.cVal}>{r.fmt(r.get(m.agent))}</Text>
                <Text style={styles.cMuted}>{r.fmt(r.get(m.team))}</Text>
                <Text style={styles.cMuted}>{r.fmt(r.get(m.prev))}</Text>
              </View>
            ))}
          </View>
        ))}
        <View style={styles.section} wrap={false}>
          <Text style={styles.h2}>Regions (agent)</Text>
          {report.regions.agent.length === 0 ? (
            <Text style={{ color: MUTED }}>No closes or drops in this period.</Text>
          ) : (
            report.regions.agent.map((r) => (
              <View key={r.region} style={styles.row}>
                <Text style={styles.cLabel}>{r.region}</Text>
                <Text style={styles.cVal}>{r.closed} closed</Text>
                <Text style={styles.cMuted}>{r.dropped} dropped</Text>
                <Text style={styles.cMuted}>{fmtDays(r.medianCloseDays)}</Text>
              </View>
            ))
          )}
        </View>
        <View style={styles.section} wrap={false}>
          <Text style={styles.h2}>Activity</Text>
          <View style={styles.row}>
            <Text style={styles.cLabel}>Sites generated (all systems)</Text>
            <Text style={styles.cVal}>{report.generation.total}</Text>
            <Text style={styles.cMuted}></Text>
            <Text style={styles.cMuted}></Text>
          </View>
          {report.attendance && (
            <View style={styles.row}>
              <Text style={styles.cLabel}>Attendance: days / hours / avg late</Text>
              <Text style={styles.cVal}>{report.attendance.days}</Text>
              <Text style={styles.cMuted}>{report.attendance.totalHours.toFixed(1)}h</Text>
              <Text style={styles.cMuted}>{Math.round(report.attendance.avgLateMinutes)}m</Text>
            </View>
          )}
        </View>
      </Page>
    </Document>
  );
}

/** Render the report to a PDF Buffer (server-only). */
export async function renderReportPdf(report: AgentPeriodicReport): Promise<Buffer> {
  return renderToBuffer(<ReportDocument report={report} />);
}
```

- [ ] **Step 10.2: `app/api/reports/agent/pdf/route.ts`** (GET so the page can link it as a plain download; `attachment` disposition per spec):

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { buildAgentPeriodicReport } from "@/lib/reports/agentPeriodic";
import { renderReportPdf } from "@/lib/reports/ReportDocument";

export const runtime = "nodejs";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("reports.agent_periodic")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const agentId = url.searchParams.get("agentId") ?? "";
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!UUID.test(agentId) || !DATE.test(from) || !DATE.test(to) || from > to) {
    return NextResponse.json({ error: "Invalid input" }, { status: 422 });
  }

  const admin = createAdminClient();
  const report = await buildAgentPeriodicReport(admin, {
    agentId,
    from,
    to,
    includeAttendance: url.searchParams.get("attendance") === "1",
  });
  if (!report) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const buffer = await renderReportPdf(report);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="agent-report-${from}-${to}.pdf"`,
    },
  });
}
```

- [ ] **Step 10.3:** Run: `npx tsc --noEmit` → clean; `npm run lint` → clean; `npm test` → PASS.
- [ ] **Step 10.4:** Commit:

```bash
git add lib/reports/ReportDocument.tsx app/api/reports/agent/pdf/route.ts
git commit -m "feat(reports): PDF export via react-pdf"
```

---

### Task 11: Full verification + browser smoke test

- [ ] **Step 11.1:** Run the full gates: `npm test` (all pass), `npm run lint` (clean), `npm run build` (succeeds — this catches App Router misuse the type check can't).
- [ ] **Step 11.2:** Browser smoke test against the dev server (preview tools, NOT Bash): sign in as an admin, open `/reports/agent` from the sidebar, generate a report for a real agent + current month, confirm all sections render and Download PDF returns a file. NOTE: until migration 0065 is applied to the DB, the page/report queries will fail on the missing table/columns — if verifying pre-migration, expect and document that failure mode instead. Check the dashboard renders the 4 new KPI tiles (values "—"/0 pre-backfill is correct).
- [ ] **Step 11.3:** Commit any fixes; then use superpowers:finishing-a-development-branch to decide merge/PR.

---

## Deployment runbook (operator steps — Claude does NOT apply migrations)

Order is mandatory (shared prod DB; same rule as the 0062 rate-limiter incident):

1. **Operator reviews + applies `supabase/migrations/0065_agent_periodic_report.sql`** to the prod DB. Old code keeps running safely (columns/table are invisible to it).
2. **Deploy code**: merge branch, build, restart pm2 `sed-lms` on the prod box.
3. **Run the backfill once** on the prod box: `node --env-file=.env.local scripts/backfill-status-events.mjs` — then spot-check 3–5 known leads' closed_at/dropped_at against reality, and re-run is safe (idempotent).
4. Verify: dashboard velocity cards show data; generate one report; download its PDF.
