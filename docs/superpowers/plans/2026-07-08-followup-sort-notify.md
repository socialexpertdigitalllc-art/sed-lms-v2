# Sorting, Follow-Up Rules & Notification Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Add a lead sort control; make the follow-up time always required; restrict follow-ups to Ready/Long-Term leads; and stand up a notification subsystem (per-user settings + in-app bell) whose first event is a follow-up reminder fired 15 min (configurable per user) before the follow-up time.

**Architecture:** Pure logic in `lib/leads/followups.ts` (eligibility, always-required validate) + new `lib/notifications/*` (event registry, settings resolution, reminder-window predicate). Two new tables (`notifications`, `user_notification_settings`). A secret-gated poller (WGE pattern) generates dedup'd reminders; the top-bar bell surfaces them; admins manage per-user enable+timing on the user page.

**Tech:** Next.js 16, React 19, TS, Tailwind v4, Supabase, Vitest. Spec: `docs/superpowers/specs/2026-07-08-followup-sort-notify-design.md`.

**Conventions:** tests `npx vitest run tests/<f> --reporter=basic`; build `NODE_OPTIONS=--max-old-space-size=6144 npm run build`; typecheck `npx tsc --noEmit`. Stage files explicitly; commit per task. npx/npm slow — be patient.

---

### Task 1: Migration 0014 (notifications tables) — MAIN SESSION

**Files:** Create `supabase/migrations/0014_notifications.sql`; apply via Supabase MCP (project `ikuvbxjkoojtgekapbul`).

```sql
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_key text not null,
  lead_id uuid references public.leads(id) on delete set null,
  title text not null,
  body text not null,
  dedup_key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create unique index if not exists notifications_dedup_key_idx on public.notifications (dedup_key);
create index if not exists notifications_user_unread_idx on public.notifications (user_id, read_at, created_at desc);

create table if not exists public.user_notification_settings (
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_key text not null,
  enabled boolean not null default true,
  lead_time_minutes int not null default 15,
  primary key (user_id, event_key)
);

alter table public.notifications enable row level security;
drop policy if exists "read own notifications" on public.notifications;
create policy "read own notifications" on public.notifications
  for select to authenticated using (user_id = auth.uid());

alter table public.user_notification_settings enable row level security;
drop policy if exists "read own or admin notif settings" on public.user_notification_settings;
create policy "read own or admin notif settings" on public.user_notification_settings
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
alter table public.notifications replica identity full;
```

- [ ] Write file. Apply via MCP `apply_migration` name `notifications`. Verify: both tables exist; policies present; `public.is_admin()` exists (it does — used by profiles RLS). Commit.

---

### Task 2: `lib/leads/followups.ts` — always-required validate + eligibility (TDD)

**Files:** Modify `lib/leads/followups.ts`; Modify `tests/followups.test.ts`.

- [ ] **Step 1: Update tests.** In `tests/followups.test.ts`, change the `validateFollowUp` "Pickup allows empty next time" case to require it, and add eligibility tests:

```ts
it("requires a future next time for BOTH statuses", () => {
  expect(validateFollowUp({ fu_status: "Pickup", next_follow_up_time: "" }, NOW).next_follow_up_time).toBeTruthy();
  expect(validateFollowUp({ fu_status: "Pickup", next_follow_up_time: "2026-07-06T10:00" }, NOW).next_follow_up_time).toBeTruthy();
  expect(validateFollowUp({ fu_status: "Pickup", next_follow_up_time: "2026-07-08T10:00" }, NOW)).toEqual({});
  expect(validateFollowUp({ fu_status: "No Pickup", next_follow_up_time: "2026-07-08T10:00" }, NOW)).toEqual({});
});

import { isFollowUpEligible, FOLLOWUP_STATUSES } from "@/lib/leads/followups";
describe("isFollowUpEligible", () => {
  it("only Ready and Long Term", () => {
    expect(FOLLOWUP_STATUSES).toEqual(["Ready", "Long Term"]);
    expect(isFollowUpEligible("Ready")).toBe(true);
    expect(isFollowUpEligible("Long Term")).toBe(true);
    expect(isFollowUpEligible("Not Ready")).toBe(false);
    expect(isFollowUpEligible("Closed")).toBe(false);
  });
});
```
Remove/replace the old "Pickup allows empty" test.

- [ ] **Step 2: Run → fail.** **Step 3: Implement:**
  - In `validateFollowUp`, replace the status-conditional next-time logic with: always require a future `next_follow_up_time`:
    ```ts
    const t = new Date(raw).getTime();
    if (!raw || Number.isNaN(t) || t <= now.getTime())
      e.next_follow_up_time = "Set a future next follow-up time.";
    ```
    (Keep the `fu_status` required check.)
  - Add:
    ```ts
    export const FOLLOWUP_STATUSES = ["Ready", "Long Term"] as const;
    export function isFollowUpEligible(status: string): boolean {
      return (FOLLOWUP_STATUSES as readonly string[]).includes(status);
    }
    ```
- [ ] **Step 4: Run → pass** (full suite). **Step 5: Commit** `feat: follow-up time always required + Ready/Long-Term eligibility`.

---

### Task 3: `lib/notifications/*` pure logic (TDD)

**Files:** Create `lib/notifications/events.ts`, `lib/notifications/logic.ts`, `tests/notifications.test.ts`.

- [ ] **Step 1: events.ts:**
```ts
export const NOTIFICATION_EVENTS = [
  {
    key: "followup_reminder",
    label: "Follow-up reminder",
    description: "Remind the lead's agent before a scheduled follow-up.",
    defaultLeadTimeMinutes: 15,
    hasTiming: true,
  },
] as const;
export type NotificationEventKey = (typeof NOTIFICATION_EVENTS)[number]["key"];
export function eventDefault(key: string) {
  return NOTIFICATION_EVENTS.find((e) => e.key === key);
}
```

- [ ] **Step 2: Failing tests** `tests/notifications.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { effectiveSetting, shouldRemind } from "@/lib/notifications/logic";

describe("effectiveSetting", () => {
  it("falls back to event defaults when no row", () => {
    expect(effectiveSetting("followup_reminder", undefined)).toEqual({ enabled: true, leadTimeMinutes: 15 });
  });
  it("uses the row when present", () => {
    expect(effectiveSetting("followup_reminder", { enabled: false, lead_time_minutes: 30 }))
      .toEqual({ enabled: false, leadTimeMinutes: 30 });
  });
});

describe("shouldRemind", () => {
  const now = new Date("2026-07-08T12:00:00");
  it("fires inside the window", () => {
    // follow-up at 12:10, lead time 15 → window opened at 11:55, now 12:00, before follow-up
    expect(shouldRemind("2026-07-08T12:10:00", 15, now)).toBe(true);
  });
  it("does not fire before the window opens", () => {
    // follow-up at 12:30, lead time 15 → opens 12:15, now 12:00
    expect(shouldRemind("2026-07-08T12:30:00", 15, now)).toBe(false);
  });
  it("does not fire once the follow-up time has passed", () => {
    expect(shouldRemind("2026-07-08T11:59:00", 15, now)).toBe(false);
  });
  it("null / bad time → false", () => {
    expect(shouldRemind(null, 15, now)).toBe(false);
    expect(shouldRemind("nope", 15, now)).toBe(false);
  });
});
```

- [ ] **Step 3: logic.ts:**
```ts
import { eventDefault } from "./events";

export function effectiveSetting(
  eventKey: string,
  row: { enabled: boolean; lead_time_minutes: number } | undefined | null
): { enabled: boolean; leadTimeMinutes: number } {
  if (row) return { enabled: row.enabled, leadTimeMinutes: row.lead_time_minutes };
  const d = eventDefault(eventKey);
  return { enabled: true, leadTimeMinutes: d?.defaultLeadTimeMinutes ?? 15 };
}

/** Is `now` inside [followUpTime − leadTime, followUpTime)? */
export function shouldRemind(
  followUpTime: string | null,
  leadTimeMinutes: number,
  now: Date = new Date()
): boolean {
  if (!followUpTime) return false;
  const t = new Date(followUpTime).getTime();
  if (Number.isNaN(t)) return false;
  const opens = t - leadTimeMinutes * 60_000;
  const n = now.getTime();
  return n >= opens && n < t;
}
```
- [ ] **Step 4: Run → pass** (full suite). **Step 5: Commit** `feat: notification event registry + settings/window logic`.

---

### Task 4: Enforce always-required + eligibility in modal & API

**Files:** Modify `components/leads/FollowUpModal.tsx`, `app/api/leads/[id]/follow-ups/route.ts`.

- [ ] **FollowUpModal:** the Next Follow Up time field now renders for BOTH branches and is always required. Simplify: show Comments + Status only for Pickup, but the Next Follow Up time + its "Required" hint always show (move it out of the branch-specific blocks or include it in both). Remove the `terminal` optional-hint logic (hint is always "Required"). `validateFollowUp` already enforces it. Keep hooks-before-early-return.
- [ ] **API POST** (`follow-ups/route.ts`): (1) after loading the lead, add eligibility: `import { isFollowUpEligible } from "@/lib/leads/followups";` then `if (!isFollowUpEligible(lead.status)) return NextResponse.json({ error: "Follow-ups apply only to Ready or Long Term leads." }, { status: 422 });`. (2) Replace the No-Pickup-only future-time guard with an **always** guard: `if (!next || new Date(next).getTime() <= Date.now()) return 422 "A future next follow-up time is required.";` (applies to both statuses; remove the isPickup-specific past check since it's now covered).
- [ ] typecheck + `npx vitest run` (142+ green) + build. Commit `feat: enforce required follow-up time + Ready/Long-Term eligibility in modal & API`.

---

### Task 5: Lead sort control (A)

**Files:** Modify `components/leads/LeadsTable.tsx`. READ IT FIRST (it uses TanStack `sorting`/`setSorting`).

- [ ] Add a **"Sort by"** `<select>` in the toolbar (near the agent/type filters) with options: `created_desc` "Submitted date" (default), `followup_asc` "Follow-up time", `rating_desc` "Rating", `name_asc` "Alphabetical". onChange maps to `setSorting`:
  ```ts
  const SORTS: Record<string, { id: string; desc: boolean }> = {
    created_desc: { id: "created_at", desc: true },
    followup_asc: { id: "follow_up_time", desc: false },
    rating_desc: { id: "rating", desc: true },
    name_asc: { id: "business_name", desc: false },
  };
  ```
  `onChange={(e) => setSorting([SORTS[e.target.value]])}`. Ensure the `business_name` column is sortable (it has an accessor; TanStack sorts by it). Keep header-click sorting working. Style the select like the existing filter selects.
- [ ] typecheck + build. Commit `feat: sort control on leads list`.

---

### Task 6: Eligibility UI gates (C)

**Files:** Modify `components/leads/LeadsTable.tsx`, `components/leads/RecentFollowUps.tsx` (+ its callers passing lead status), `components/leads/FollowUpQueue.tsx`.

- [ ] **LeadsTable:** the row "Follow Up" button renders only when `canFollowUp && isFollowUpEligible(row.original.status)`.
- [ ] **RecentFollowUps:** add a `leadStatus: string` prop; the "Follow Up" button shows only when `has("leads.followup") && isFollowUpEligible(leadStatus)`. Update its caller in `LeadDetail.tsx` to pass `leadStatus={lead.status}`.
- [ ] **FollowUpQueue:** filter to eligible leads before grouping: `const eligible = leads.filter((l) => isFollowUpEligible(l.status)); const groups = groupByBucket(eligible, new Date());`. Update the header counts accordingly.
- [ ] typecheck + `npx vitest run` + build. Commit `feat: restrict follow-up entry points to Ready/Long-Term leads`.

---

### Task 7: Notification generation route + poller

**Files:** Create `app/api/notifications/generate/route.ts`; Modify `lib/supabase/middleware.ts` (isPublic exemption); Modify `instrumentation.ts`.

- [ ] **Route** `POST /api/notifications/generate`: header `x-wge-secret` must equal `process.env.WGE_PROCESSOR_SECRET` (fail-closed if unset → 401). Then, with the admin client:
  1. `leads` select `id, business_name, agent_id, status, follow_up_time` where `deleted_at is null and follow_up_time is not null and agent_id is not null and status in ('Ready','Long Term')`.
  2. Batch-load `user_notification_settings` for `event_key='followup_reminder'` and the involved `agent_id`s → Map by user_id.
  3. For each lead: `const s = effectiveSetting("followup_reminder", settingMap.get(lead.agent_id));` if `s.enabled && shouldRemind(lead.follow_up_time, s.leadTimeMinutes, new Date())` → build `dedup_key = \`followup_reminder:${lead.id}:${new Date(lead.follow_up_time).toISOString()}\`` and insert a notification `{ user_id: lead.agent_id, event_key: "followup_reminder", lead_id: lead.id, title: "Follow-up due soon", body: \`${lead.business_name} — follow up at ${formatDateTime(lead.follow_up_time)}\`, dedup_key }`. Use a single `insert([...]).select()` with **upsert on dedup_key ignoring conflicts**: `admin.from("notifications").upsert(rows, { onConflict: "dedup_key", ignoreDuplicates: true })`. Return `{ created: rows.length }`.
  - Imports: `effectiveSetting`, `shouldRemind` from `@/lib/notifications/logic`; `formatDateTime` from `@/lib/leads/format`; `createAdminClient`.
- [ ] **middleware isPublic:** add exact-match exemption for `/api/notifications/generate` (mirror the `/api/ai-tools/wge/process` exemption).
- [ ] **instrumentation.ts:** add a second `setInterval` (60_000) hitting `${origin}/api/notifications/generate` with the secret header, guarded by the same `if (!secret) return`.
- [ ] typecheck + build. Commit `feat: follow-up reminder generation route + poller`.

---

### Task 8: Notification bell + read API

**Files:** Create `app/api/notifications/route.ts` (GET), `app/api/notifications/[id]/read/route.ts` (POST); Modify `components/layout/NotificationBell.tsx`. Optional helper `lib/notifications/types.ts` (`Notification` interface).

- [ ] **GET `/api/notifications`**: auth; user-scoped select of `notifications` where `user_id=auth.uid()` (RLS also enforces), `?unread=1` → `read_at is null`; order created_at desc; limit 50; return `{ notifications }`.
- [ ] **POST `/api/notifications/[id]/read`**: auth; admin/user-scoped update `read_at = now()` where `id = :id and user_id = auth.uid()` (user client, RLS-scoped) — or service role with an explicit `user_id=auth.uid()` filter. Return `{ ok: true }`. (Also accept `POST /api/notifications/read-all` OR support `id="all"` to mark all unread read — implement a simple all-read: if body `{ all: true }` update all unread for the user.)
- [ ] **NotificationBell:** add `const [notes, setNotes] = useState<Notification[]>([])`; fetch `/api/notifications?unread=1` in a `useEffect` (independent, fail-soft). Add a **"Reminders"** section at the top of the dropdown listing them (title + body + relative/formatted time). Include `notes.length` in the badge `count`. Clicking a reminder: `POST /api/notifications/${n.id}/read` then navigate to `/leads/${n.lead_id}` (use a Link + onClick, or router.push). Add a "Mark all read" affordance that calls the all-read endpoint and clears. Keep the existing pre-lead/WGE sections and the fail-soft behavior.
- [ ] typecheck + build. Commit `feat: notifications bell + read API`.

---

### Task 9: Admin per-user notification settings

**Files:** Create `app/api/admin/users/[id]/notification-settings/route.ts` (GET+PUT), `components/admin/NotificationSettings.tsx`; Modify `app/(app)/admin/users/[id]/page.tsx`. Match the admin gating used by `app/api/admin/users/[id]/overrides/route.ts` (READ IT for the exact perm + patterns).

- [ ] **API:** GET → the user's `user_notification_settings` rows (admin-gated). PUT body `{ settings: { event_key, enabled, lead_time_minutes }[] }` → validate event_key ∈ NOTIFICATION_EVENTS keys and `lead_time_minutes` a non-negative int; upsert each row (admin client) with `onConflict: "user_id,event_key"`. Audit-log `notification.settings.updated`. Same admin-permission gate as the overrides route.
- [ ] **NotificationSettings component** (`{ userId: string; rows: {event_key,enabled,lead_time_minutes}[] }`, client): render a small card "Notifications" listing `NOTIFICATION_EVENTS`; per event an **enabled** toggle + (when `hasTiming`) a **minutes-before** number input, seeded from the row or the event default. A "Save" button PUTs the full set. Data Console styling.
- [ ] **Admin user page:** load the rows (`from("user_notification_settings").select("*").eq("user_id", id)`) and render `<NotificationSettings userId={id} rows={...} />` after `UserManager`.
- [ ] typecheck + build. Commit `feat: admin per-user notification settings`.

---

### Task 10: Verification

- [ ] `npx vitest run --reporter=basic` all green; `NODE_OPTIONS=--max-old-space-size=6144 npm run build` green.
- [ ] **Live (Chrome, admin):** (1) sort dropdown reorders each way. (2) follow-up modal: empty next time blocked on both Pickup and No Pickup. (3) "Follow Up" button absent on a Not Ready/Closed lead, present on Ready/Long-Term; queue lists only eligible leads. (4) Set a Ready lead's follow-up ~2 min out; POST `/api/notifications/generate` with the secret header (or wait for the poller); the agent's bell shows the reminder; click → marks read + opens the lead. (5) Admin → User: toggle `followup_reminder` off / change minutes → re-generate → behavior reflects it. Clean up any test notifications/rows afterward.
- [ ] Update `docs/AUDIT.md` + memory. Commit `chore: verify sorting, follow-up rules, notification foundation`.

---

## Self-Review Notes
- Spec coverage: A→T5; B→T2(validate)+T4(modal/API); C→T2(eligible)+T4(API)+T6(UI); D tables→T1, logic→T3, generation→T7, bell→T8, admin→T9; verify→T10.
- `isFollowUpEligible`/`FOLLOWUP_STATUSES`, `effectiveSetting`/`shouldRemind`, `NOTIFICATION_EVENTS`, `dedup_key` format consistent across tasks.
- Deferred: other events, email/push, user self-service prefs.
