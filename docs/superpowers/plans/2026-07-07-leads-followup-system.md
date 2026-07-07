# Leads Follow-Up System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** A full follow-up system for leads — Pickup/No-Pickup entry modal, append-only history, sticky recent-follow-ups on the lead detail, per-row signals on the leads list, and a dedicated Overdue/Due-today/Upcoming queue.

**Architecture:** New `lead_follow_ups` table (append-only) + denormalized `last_followup_status` / `no_pickup_streak` / synced `follow_up_time` on `leads` for cheap reads. Pure grouping/validation logic in `lib/leads/followups.ts` (TDD). Writes go through a service-role API behind `leads.followup`; reads are RLS-scoped. UI: entry/detail/log modals, list signals, detail panel, queue page.

**Tech:** Next.js 16, React 19, TS, Tailwind v4, Supabase, Vitest. Spec: `docs/superpowers/specs/2026-07-07-leads-followup-system-design.md`.

**Conventions:** tests `npx vitest run tests/<f> --reporter=basic`; build `NODE_OPTIONS=--max-old-space-size=6144 npm run build`; typecheck `npx tsc --noEmit`. Stage files explicitly, commit per task. npm/npx slow to start — be patient.

---

### Task 1: Migration 0013 (schema + perm + RLS)

**Files:** Create `supabase/migrations/0013_lead_followups.sql`. Apply via Supabase MCP (main session; project `ikuvbxjkoojtgekapbul`).

- [ ] **Step 1: Write the migration**

```sql
-- Append-only lead follow-up log + denormalized signals on leads.
create table if not exists public.lead_follow_ups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  fu_status text not null,                 -- 'Pickup' | 'No Pickup'
  comments text,
  next_follow_up_time timestamptz,
  status_change text,
  created_at timestamptz not null default now()
);
create index if not exists lead_follow_ups_lead_created_idx
  on public.lead_follow_ups (lead_id, created_at desc);

alter table public.leads add column if not exists last_followup_status text;
alter table public.leads add column if not exists no_pickup_streak int not null default 0;

alter table public.lead_follow_ups enable row level security;
drop policy if exists "read lead follow-ups" on public.lead_follow_ups;
create policy "read lead follow-ups" on public.lead_follow_ups
  for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));

insert into public.permissions (key, name, description, category, is_sensitive) values
  ('leads.followup','Log Lead Follow-ups','Record follow-up calls and outcomes on leads','leads',false)
on conflict (key) do nothing;

insert into public.department_permissions (department_id, permission_key)
select distinct department_id, 'leads.followup' from public.department_permissions
where permission_key in ('pre_leads.followup','leads.edit')
on conflict do nothing;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='lead_follow_ups') then
    alter publication supabase_realtime add table public.lead_follow_ups;
  end if;
end $$;
alter table public.lead_follow_ups replica identity full;
```

- [ ] **Step 2: Apply** via MCP `apply_migration` name `lead_followups`. (Main-session step.)
- [ ] **Step 3: Verify** via `execute_sql`: table exists; `select count(*) from permissions where key='leads.followup'` = 1; `leads.followup` seeded to sales+management+admin; both new leads columns exist; policy present.
- [ ] **Step 4: Commit** `git add supabase/migrations/0013_lead_followups.sql && git commit -m "feat: migration 0013 - lead_follow_ups table, signals, leads.followup perm"`

---

### Task 2: Pure logic `lib/leads/followups.ts` (TDD)

**Files:** Create `lib/leads/followups.ts`, Test `tests/followups.test.ts`.

- [ ] **Step 1: Failing tests** — `tests/followups.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { bucketOf, groupByBucket, validateFollowUp, nextStreak } from "@/lib/leads/followups";

const NOW = new Date("2026-07-07T12:00:00");

describe("bucketOf", () => {
  it("null → none", () => expect(bucketOf(null, NOW)).toBe("none"));
  it("past → overdue", () => expect(bucketOf("2026-07-07T11:59:00", NOW)).toBe("overdue"));
  it("later today → today", () => expect(bucketOf("2026-07-07T20:00:00", NOW)).toBe("today"));
  it("end of today → today", () => expect(bucketOf("2026-07-07T23:59:59", NOW)).toBe("today"));
  it("tomorrow → upcoming", () => expect(bucketOf("2026-07-08T09:00:00", NOW)).toBe("upcoming"));
});

describe("groupByBucket", () => {
  it("buckets and sorts by time asc within each", () => {
    const leads = [
      { id: "a", follow_up_time: "2026-07-08T10:00:00" },
      { id: "b", follow_up_time: "2026-07-07T06:00:00" },
      { id: "c", follow_up_time: null },
      { id: "d", follow_up_time: "2026-07-07T18:00:00" },
      { id: "e", follow_up_time: "2026-07-05T10:00:00" },
    ] as never[];
    const g = groupByBucket(leads, NOW);
    expect(g.overdue.map((l) => l.id)).toEqual(["e", "b"]);
    expect(g.today.map((l) => l.id)).toEqual(["d"]);
    expect(g.upcoming.map((l) => l.id)).toEqual(["a"]);
    expect(g.none.map((l) => l.id)).toEqual(["c"]);
  });
});

describe("validateFollowUp", () => {
  it("requires fu_status", () => {
    expect(validateFollowUp({ fu_status: "" }, NOW).fu_status).toBeTruthy();
  });
  it("No Pickup requires a future next time", () => {
    expect(validateFollowUp({ fu_status: "No Pickup", next_follow_up_time: "" }, NOW).next_follow_up_time).toBeTruthy();
    expect(validateFollowUp({ fu_status: "No Pickup", next_follow_up_time: "2026-07-06T10:00" }, NOW).next_follow_up_time).toBeTruthy();
    expect(validateFollowUp({ fu_status: "No Pickup", next_follow_up_time: "2026-07-08T10:00" }, NOW)).toEqual({});
  });
  it("Pickup allows empty next time but rejects a past one", () => {
    expect(validateFollowUp({ fu_status: "Pickup", next_follow_up_time: "" }, NOW)).toEqual({});
    expect(validateFollowUp({ fu_status: "Pickup", next_follow_up_time: "2026-07-06T10:00" }, NOW).next_follow_up_time).toBeTruthy();
  });
});

describe("nextStreak", () => {
  it("increments on No Pickup, resets on Pickup", () => {
    expect(nextStreak(2, "No Pickup")).toBe(3);
    expect(nextStreak(2, "Pickup")).toBe(0);
  });
});
```

- [ ] **Step 2: Run → fail.** `npx vitest run tests/followups.test.ts --reporter=basic`
- [ ] **Step 3: Implement** `lib/leads/followups.ts`:

```ts
export const FU_STATUSES = ["Pickup", "No Pickup"] as const;
export type FuStatus = (typeof FU_STATUSES)[number];

export interface LeadFollowUp {
  id: string;
  lead_id: string;
  user_id: string | null;
  fu_status: string;
  comments: string | null;
  next_follow_up_time: string | null;
  status_change: string | null;
  created_at: string;
  logger_name?: string | null;
}

export type FollowUpBucket = "overdue" | "today" | "upcoming" | "none";

function endOfToday(now: Date): number {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function bucketOf(followUpTime: string | null, now: Date = new Date()): FollowUpBucket {
  if (!followUpTime) return "none";
  const t = new Date(followUpTime).getTime();
  if (Number.isNaN(t)) return "none";
  if (t < now.getTime()) return "overdue";
  if (t <= endOfToday(now)) return "today";
  return "upcoming";
}

type HasFollowUp = { follow_up_time: string | null };

export function groupByBucket<T extends HasFollowUp>(leads: T[], now: Date = new Date()) {
  const g: Record<FollowUpBucket, T[]> = { overdue: [], today: [], upcoming: [], none: [] };
  for (const l of leads) g[bucketOf(l.follow_up_time, now)].push(l);
  const byTime = (a: T, b: T) =>
    (a.follow_up_time ? new Date(a.follow_up_time).getTime() : Infinity) -
    (b.follow_up_time ? new Date(b.follow_up_time).getTime() : Infinity);
  g.overdue.sort(byTime);
  g.today.sort(byTime);
  g.upcoming.sort(byTime);
  return g;
}

export function nextStreak(prev: number, fu_status: string): number {
  return fu_status === "No Pickup" ? prev + 1 : 0;
}

export function validateFollowUp(
  input: { fu_status: string; next_follow_up_time?: string },
  now: Date = new Date()
): Record<string, string> {
  const e: Record<string, string> = {};
  if (!input.fu_status) e.fu_status = "Select Pickup or No Pickup.";
  const raw = input.next_follow_up_time ?? "";
  const future = () => {
    const t = new Date(raw).getTime();
    return !Number.isNaN(t) && t > now.getTime();
  };
  if (input.fu_status === "No Pickup") {
    if (!raw || !future()) e.next_follow_up_time = "Set a future next follow-up time.";
  } else if (input.fu_status === "Pickup" && raw && !future()) {
    e.next_follow_up_time = "Next follow-up must be in the future.";
  }
  return e;
}
```

- [ ] **Step 4: Run → pass** (full suite too). **Step 5: Commit** `feat: lead follow-up grouping + validation logic`.

---

### Task 3: API routes + Zod schema

**Files:** Create `app/api/leads/[id]/follow-ups/route.ts`, `lib/leads/followupSchema.ts`.

- [ ] **Step 1: Schema** `lib/leads/followupSchema.ts`:

```ts
import { z } from "zod";
import { FU_STATUSES } from "./followups";
import { LEAD_STATUSES } from "./types";

const opt = (inner: z.ZodTypeAny) => z.preprocess((v) => (v === "" || v === undefined ? null : v), inner);

export const logFollowUpSchema = z.object({
  fu_status: z.enum(FU_STATUSES),
  comments: opt(z.string().nullable()),
  next_follow_up_time: opt(z.string().nullable()),
  status_change: opt(z.enum(LEAD_STATUSES).nullable()),
});
export type LogFollowUpInput = z.infer<typeof logFollowUpSchema>;
```

- [ ] **Step 2: Route** `app/api/leads/[id]/follow-ups/route.ts` — mirror the patterns in `app/api/leads/[id]/route.ts`:

`GET`: auth → `leads.view` → user-scoped client select from `lead_follow_ups` where `lead_id = id` order by `created_at desc`; join logger name via a second lookup or an embedded select `user_id ( display_name )` pinned FK if needed; return `{ followUps }`.

`POST`: auth → `leads.followup` (403 else). Load the lead with the **user-scoped** client (`.eq("id",id).is("deleted_at",null).single()`) → 404 if not visible. Parse `logFollowUpSchema` (422 else). Then, with `const admin = createAdminClient()`:
```ts
const isPickup = parsed.data.fu_status === "Pickup";
const next = parsed.data.next_follow_up_time
  ? new Date(parsed.data.next_follow_up_time).toISOString() : null;
// No Pickup must have a future next time (defense-in-depth mirroring the client)
if (parsed.data.fu_status === "No Pickup" && (!next || new Date(next).getTime() <= Date.now()))
  return NextResponse.json({ error: "A future next follow-up time is required." }, { status: 422 });

const statusChange = isPickup ? parsed.data.status_change : null;
if (statusChange && !perms.has(catSetKey(statusChange)))
  return NextResponse.json({ error: `You cannot set status "${statusChange}".` }, { status: 403 });

const { data: fu, error } = await admin.from("lead_follow_ups").insert({
  lead_id: id, user_id: user.id, fu_status: parsed.data.fu_status,
  comments: isPickup ? parsed.data.comments : null,
  next_follow_up_time: next, status_change: statusChange,
}).select("*").single();
if (error || !fu) return 400;

const leadUpdate: Record<string, unknown> = {
  follow_up_time: next,
  last_followup_status: parsed.data.fu_status,
  no_pickup_streak: nextStreak(lead.no_pickup_streak ?? 0, parsed.data.fu_status),
};
if (statusChange) leadUpdate.status = statusChange;
await admin.from("leads").update(leadUpdate).eq("id", id);

await admin.from("activity_log").insert({
  user_id: user.id, action: "lead.followup_logged", entity_type: "lead", entity_id: id,
  new_value: { fu_status: parsed.data.fu_status, next_follow_up_time: next, status_change: statusChange },
});
return NextResponse.json({ followUp: fu }, { status: 201 });
```
Import `catSetKey` from `@/lib/leads/categories`, `nextStreak` from `@/lib/leads/followups`, `logFollowUpSchema`. The user-scoped lead load needs `no_pickup_streak` selected (use `select("*")`).

- [ ] **Step 3:** `npx tsc --noEmit`, `npx vitest run` (no new tests here; logic covered in Task 2). **Step 4: Commit** `feat: lead follow-up API (log + list)`.

---

### Task 4: FollowUpModal (entry)

**Files:** Create `components/leads/FollowUpModal.tsx`. Shared chip: create `components/leads/FuStatusChip.tsx`.

- [ ] **Step 1: FuStatusChip** — small pill: Pickup → `bg-ready-bg text-ready-fg`, No Pickup → `bg-notready-bg text-notready-fg`.

```tsx
export function FuStatusChip({ status }: { status: string }) {
  const cls = status === "Pickup" ? "bg-ready-bg text-ready-fg" : "bg-notready-bg text-notready-fg";
  return <span className={"rounded-md px-2 py-0.5 text-xs font-medium " + cls}>{status}</span>;
}
```

- [ ] **Step 2: FollowUpModal** — props `{ leadId: string; businessName: string; open: boolean; onClose: () => void }`. Uses `usePermissions` for `settableStatuses(all)`; `validateFollowUp` for errors; `RadioPillGroup` for Pickup/No Pickup; conditional fields per spec §4a. Data Console modal chrome like `StatusChangeModal`. Terminal-status rule: `const terminal = f.status_change === "Closed" || f.status_change === "Dropped";` → when Pickup, Next Follow Up is optional and required only for No Pickup; hint changes when terminal. On submit: `validateFollowUp({fu_status, next_follow_up_time}, new Date())`; if Pickup keep comments/status; POST `/api/leads/${leadId}/follow-ups` with `{ fu_status, comments, next_follow_up_time: toISO|null, status_change }`; on ok → `onClose()` + `router.refresh()`. Hooks before any early return; `if (!open) return null` after hooks.

- [ ] **Step 3:** typecheck + build. **Step 4: Commit** `feat: lead follow-up entry modal`.

---

### Task 5: Leads list — Follow Up button + row signals

**Files:** Modify `components/leads/LeadsTable.tsx`; the leads must carry `last_followup_status` + `no_pickup_streak` (already selected via `select("*")` in `app/(app)/leads/page.tsx` — verify). Extend the `Lead` type in `lib/leads/types.ts` with `last_followup_status: string | null; no_pickup_streak: number;`.

- [ ] **Step 1:** add the two fields to the `Lead` interface.
- [ ] **Step 2:** In `LeadsTable`: `const canFollowUp = has("leads.followup");` add a `[followUpLead, setFollowUpLead] = useState<Lead|null>(null)`. Add a **"Follow-up"** column rendering next follow-up time (red when `bucketOf(row.follow_up_time) === "overdue"`), a `FuStatusChip` of `last_followup_status` when present, and a streak badge `×{n}` when `no_pickup_streak > 1`. In the actions cell add a **"Follow Up"** button (when `canFollowUp`) → `setFollowUpLead(row.original)`. Render `<FollowUpModal leadId=… businessName=… open={!!followUpLead} onClose={()=>setFollowUpLead(null)} />` once (keyed by id).
- [ ] **Step 3:** typecheck + build. **Step 4: Commit** `feat: follow-up button + row signals on leads list`.

---

### Task 6: Lead detail — sticky Recent follow-ups + detail/log modals

**Files:** Modify `app/(app)/leads/[id]/page.tsx` (fetch follow-ups server-side, pass down), `components/leads/LeadDetail.tsx` (two-column + panel). Create `components/leads/FollowUpDetailModal.tsx`, `components/leads/FollowUpLogModal.tsx`, `components/leads/RecentFollowUps.tsx`.

- [ ] **Step 1: Detail page** — after loading the lead, load its follow-ups (RLS-scoped user client) `from("lead_follow_ups").select("*, profiles:user_id(display_name)").eq("lead_id", id).order("created_at",{ascending:false})`, map `logger_name`, pass `followUps` to `LeadDetail`.
- [ ] **Step 2: RecentFollowUps** panel (`{ leadId, businessName, followUps }`): sticky card; header "Recent follow-ups" + a **Follow Up** button (gated `leads.followup`) opening `FollowUpModal`; list the first 3 as `FollowUpCard`s (status chip, `formatDateTime(created_at)`, comments snippet or "No pickup", "Next: …"); clicking a card sets a `selected` follow-up → `FollowUpDetailModal`; a **"See all follow-ups (N)"** button opens `FollowUpLogModal` (all rows; each entry click → detail modal). Empty state: "No follow-ups yet."
- [ ] **Step 3: LeadDetail** — wrap the existing content and the panel in `grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6`; existing detail in the left col (add `min-w-0`); `<RecentFollowUps>` in a right `aside` (`hidden lg:block`, sticky). Keep all existing edit logic intact.
- [ ] **Step 4: FollowUpDetailModal** `{ followUp, open, onClose }` — shows status chip, logged-by + created_at, comments (Pickup), next follow-up, status change. **FollowUpLogModal** `{ followUps, open, onClose, onSelect }` — scrollable list of compact rows, each calls `onSelect(fu)`.
- [ ] **Step 5:** typecheck + build. **Step 6: Commit** `feat: sticky recent follow-ups + history modals on lead detail`.

---

### Task 7: Queue page + nav

**Files:** Create `app/(app)/leads/follow-ups/page.tsx`, `components/leads/FollowUpQueue.tsx`. Modify the sidebar (`components/layout/Sidebar.tsx` or wherever the Leads nav group is — grep `"/by-agent"` / `"Leads"`).

- [ ] **Step 1: Page** — server component: auth + `leads.view` (else redirect `/leads`); load visible non-deleted leads + agent names (like `leads/page.tsx`); pass to `FollowUpQueue`.
- [ ] **Step 2: FollowUpQueue** (client) — `groupByBucket(leads, new Date())`; render sections Overdue (red header) · Due today · Upcoming · No follow-up set, each with a count and rows (business + `StatusPill`, next follow-up time, `FuStatusChip` last outcome + streak, **Follow Up** button → `FollowUpModal`, Detail link). Reuse `useRealtimeRefresh("leads")`. Empty sections hidden.
- [ ] **Step 3: Nav** — add a "Follow-ups" link (href `/leads/follow-ups`, gated `leads.view`) under the Leads group; longest-prefix active match must not break `/leads`.
- [ ] **Step 4:** typecheck + build. **Step 5: Commit** `feat: leads follow-up queue view + nav`.

---

### Task 8: Full verification

- [ ] **Step 1:** `npx vitest run --reporter=basic` (all pass incl. Task 2), `NODE_OPTIONS=--max-old-space-size=6144 npm run build` green.
- [ ] **Step 2: Live (Chrome MCP, admin — has leads.followup):**
  1. On a lead row, click **Follow Up** → No Pickup → set a future time → submit; row shows the No-Pickup chip + next time; log again No Pickup → streak `×2`.
  2. Click **Follow Up** → Pickup → comments + a future next time + status update (e.g. Ready) → submit; lead status changes, streak resets, comments visible in the detail popup.
  3. Lead detail: sticky **Recent follow-ups** shows ≤3 cards; click one → detail popup; **See all** → full log; **Follow Up** button works.
  4. `/leads/follow-ups`: leads grouped correctly (overdue red); the lead just scheduled appears in the right bucket.
- [ ] **Step 3:** update `docs/AUDIT.md` + memory. **Step 4: Commit** `chore: verify leads follow-up system`.

---

## Self-Review Notes
- Spec coverage: table/perm/RLS → T1; logic → T2; API → T3; entry modal → T4; list button+signals → T5; detail panel+history → T6; queue+nav → T7; verify → T8.
- Denormalized `follow_up_time`/`last_followup_status`/`no_pickup_streak` written in T3's POST, read in T5/T7 — column names consistent.
- `FuStatus`/`FU_STATUSES`, `bucketOf`, `nextStreak`, `catSetKey` names consistent across tasks.
- Deferred (not in plan): notifications/bell, follow-up edit/delete, pre-lead changes.
