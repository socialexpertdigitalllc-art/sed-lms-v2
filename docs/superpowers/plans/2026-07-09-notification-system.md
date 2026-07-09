# Notification System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded notification recipients with an admin-configurable routing engine (departments + users + contextual roles per event, with timing), split the header into two bells (Website / General), add a `/notifications` inbox, four new events, and a DB trigger requiring `website_link` before a lead can be Ready.

**Architecture:** A seeded `notification_rules` table + a single pure resolver (`expandTargets`) that every fire-site routes through via a unified `notify()`. `notifications` gains `bell` + `deliver_after`. Per-user opt-out is retired. In-app only, structured to add channels later.

**Tech Stack:** Next.js 16 App Router + TS, Supabase (Postgres/RLS/triggers/service role), Zod, Vitest. Project `ikuvbxjkoojtgekapbul`. Migrations written to `supabase/migrations/` AND applied to remote via Supabase MCP `apply_migration` (controller applies after review).

**Environment notes:**
- Windows; npm slow — targeted `npx vitest run <file>` + `npx tsc --noEmit`; full `npm run build` at group ends.
- Playwright headless fails → live verify via Claude-in-Chrome MCP (harness clicks miss sticky header buttons — drive via `javascript_tool` fetch when needed).
- Writes via `createAdminClient()`; route perms via `getUserPermissions(user.id)` + `perms.has(...)`.
- `department_members` embeds MUST pin `!department_members_user_id_fkey`.
- **Reference templates:** `lib/tickets/notify.ts` + `lib/feedback/notify.ts` (current notify + `settingsFor`/`effectiveSetting`, dept-member resolvers), `app/api/notifications/generate/route.ts` (poller), `components/layout/NotificationBell.tsx` + `Topbar.tsx` (current single bell), `app/api/notifications/route.ts` + `[id]/read/route.ts`, `components/admin/NotificationSettings.tsx` (being retired), `app/api/admin/users/[id]/notification-settings/route.ts`, `app/api/leads/[id]/route.ts` + `follow-ups/route.ts` (lead status paths), `lib/leads/categories.ts`.

---

## GROUP A — Foundations

### Task 1: Migration 0020 — rules table, notification columns, Ready trigger, perm

**Files:** Create `supabase/migrations/0020_notification_rules.sql`; modify `supabase/seed.sql`.

- [ ] **Step 1: Write the SQL**

```sql
-- 0020_notification_rules.sql — admin-configurable routing + two bells + Ready guard

create table if not exists public.notification_rules (
  event_key text primary key,
  enabled boolean not null default true,
  target_departments text[] not null default '{}',
  target_users uuid[] not null default '{}',
  target_roles text[] not null default '{}',
  delay_minutes int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.notification_rules enable row level security;
create policy "read notification_rules" on public.notification_rules for select to authenticated using (true);

-- seed one row per event = today's hardcoded routing (behaviour unchanged until edited)
insert into public.notification_rules (event_key, enabled, target_departments, target_users, target_roles, delay_minutes) values
  ('followup_reminder',  true,  '{}',                '{}', '{lead_agent}',                 15),
  ('website_ready',      true,  '{}',                '{}', '{lead_agent}',                 0),
  ('lead_submitted',     true,  '{management,admin}','{}', '{}',                           0),
  ('prelead_submitted',  true,  '{management,admin}','{}', '{}',                           0),
  ('lead_status_changed',false, '{}',                '{}', '{}',                           0),
  ('ticket_opened',      true,  '{admin}',           '{}', '{}',                           0),
  ('ticket_assigned',    true,  '{}',                '{}', '{ticket_assignee}',            0),
  ('ticket_resolved',    true,  '{}',                '{}', '{ticket_creator,lead_agent}',  0),
  ('ticket_reopened',    true,  '{}',                '{}', '{ticket_assignee}',            0),
  ('ticket_overdue',     true,  '{admin}',           '{}', '{ticket_assignee}',            0),
  ('feedback_submitted', true,  '{tech,admin}',      '{}', '{}',                           0),
  ('feedback_resolved',  true,  '{}',                '{}', '{feedback_submitter}',         0)
on conflict (event_key) do nothing;

alter table public.notifications
  add column if not exists bell text not null default 'general',
  add column if not exists deliver_after timestamptz not null default now();
create index if not exists notifications_user_bell_idx on public.notifications (user_id, bell, read_at, created_at desc);

-- website_link required before a lead can be Ready (covers EVERY write path)
create or replace function public.enforce_ready_website_link() returns trigger
language plpgsql as $$
begin
  if NEW.status = 'Ready' and (NEW.website_link is null or btrim(NEW.website_link) = '') then
    raise exception 'A website link is required before a lead can be set to Ready'
      using errcode = 'check_violation';
  end if;
  return NEW;
end $$;
drop trigger if exists trg_ready_website_link on public.leads;
create trigger trg_ready_website_link before insert or update on public.leads
  for each row execute function public.enforce_ready_website_link();

insert into public.permissions (key, name, description, category, is_sensitive) values
  ('admin.notifications.manage','Manage Notification Rules',null,'admin',true)
on conflict (key) do nothing;
insert into public.department_permissions (department_id, permission_key)
  select d.id, 'admin.notifications.manage' from public.departments d where d.slug = 'admin'
on conflict do nothing;
```

- [ ] **Step 2: Mirror into `supabase/seed.sql`** — read it; add the `admin.notifications.manage` permission row + its admin grant tuple (match the file's real pattern). (The `notification_rules` seed rows live only in the migration, not seed.sql.)

- [ ] **Step 3: Commit** (controller applies migration after review)

```bash
git -C "D:/sed-lms-v2" add supabase/migrations/0020_notification_rules.sql supabase/seed.sql
git -C "D:/sed-lms-v2" commit -m "feat: migration 0020 - notification_rules, bell/deliver_after, Ready-website_link trigger, perm"
```

---

### Task 2: Event catalog + notification types + perm constants

**Files:** Modify `lib/notifications/events.ts`, `lib/notifications/types.ts`, `lib/permissions/constants.ts`.

- [ ] **Step 1: `lib/notifications/events.ts`** — add `bell`, `availableRoles`, `timingMode` to EACH existing event, and append the 4 new events. Use the exact table from the spec. Example shape:
```ts
{ key: "website_ready", label: "Website ready", description: "A lead's website is ready (moved to Ready).", defaultLeadTimeMinutes: 0, hasTiming: false, bell: "website", availableRoles: ["lead_agent","lead_closer"], timingMode: "none" },
```
Set for existing events: `followup_reminder` bell general / roles [lead_agent] / timingMode lead_time; `ticket_opened` general / [] / delay; `ticket_assigned` general / [ticket_assignee] / delay; `ticket_resolved` general / [ticket_creator,lead_agent] / delay; `ticket_reopened` general / [ticket_assignee] / delay; `ticket_overdue` general / [ticket_assignee] / delay; `feedback_submitted` general / [] / delay; `feedback_resolved` general / [feedback_submitter] / delay. New: `website_ready` (website / [lead_agent,lead_closer] / none), `lead_submitted` (general / [lead_agent] / delay), `prelead_submitted` (general / [] / delay), `lead_status_changed` (general / [lead_agent,lead_closer] / delay). Keep `NotificationEventKey` derived from the array.

- [ ] **Step 2: `lib/notifications/types.ts`** — add:
```ts
export type ContextualRole = "lead_agent" | "lead_closer" | "ticket_assignee" | "ticket_creator" | "feedback_submitter";
export type NotifyBell = "website" | "general";
export interface NotificationRule {
  event_key: string; enabled: boolean;
  target_departments: string[]; target_users: string[]; target_roles: ContextualRole[];
  delay_minutes: number;
}
export interface NotifyContext {
  leadId?: string | null;
  lead?: { agent_id: string | null; closed_by: string | null } | null;
  ticket?: { assigned_to: string | null; created_by: string | null } | null;
  feedback?: { user_id: string | null } | null;
  actorId?: string | null;
}
```
Also add `bell: NotifyBell` (and `target_url: string | null` if not already) to the existing `AppNotification` interface.

- [ ] **Step 3: `lib/permissions/constants.ts`** — add `admin.notifications.manage` (category `admin`, sensitive) to `PERMISSIONS`.

- [ ] **Step 4: Typecheck + commit**
```bash
cd "D:/sed-lms-v2" && npx tsc --noEmit
git -C "D:/sed-lms-v2" add lib/notifications/events.ts lib/notifications/types.ts lib/permissions/constants.ts
git -C "D:/sed-lms-v2" commit -m "feat: event catalog (bell/roles/timing) + 4 new events + notification types + perm"
```

---

## GROUP B — Rules engine (TDD)

### Task 3: Pure target resolver + tests

**Files:** Create `lib/notifications/resolve.ts`, `tests/notifyResolve.test.ts`.

- [ ] **Step 1: Failing tests** `tests/notifyResolve.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { expandTargets } from "@/lib/notifications/resolve";
const rule = (o: any) => ({ event_key:"x", enabled:true, target_departments:[], target_users:[], target_roles:[], delay_minutes:0, ...o });
const ctx = { lead:{ agent_id:"agent1", closed_by:"closer1" }, ticket:{ assigned_to:"dev1", created_by:"sales1" }, feedback:{ user_id:"sub1" }, actorId:null };
describe("expandTargets", () => {
  it("disabled → empty", () => expect(expandTargets(rule({ enabled:false, target_users:["u1"] }), ctx, {})).toEqual([]));
  it("departments expand via member map", () => expect(expandTargets(rule({ target_departments:["admin"] }), ctx, { admin:["a1","a2"] }).sort()).toEqual(["a1","a2"]));
  it("users pass through", () => expect(expandTargets(rule({ target_users:["u1","u2"] }), ctx, {})).toEqual(["u1","u2"]));
  it("roles resolve from context", () => expect(expandTargets(rule({ target_roles:["lead_agent","ticket_assignee"] }), ctx, {}).sort()).toEqual(["agent1","dev1"]));
  it("dedups across sources", () => expect(expandTargets(rule({ target_users:["agent1"], target_roles:["lead_agent"] }), ctx, {})).toEqual(["agent1"]));
  it("excludes the actor", () => expect(expandTargets(rule({ target_roles:["lead_agent","ticket_creator"] }), { ...ctx, actorId:"sales1" }, {})).toEqual(["agent1"]));
  it("skips null role values", () => expect(expandTargets(rule({ target_roles:["lead_closer"] }), { ...ctx, lead:{ agent_id:"a", closed_by:null } }, {})).toEqual([]));
});
```
Run → fail.

- [ ] **Step 2: Implement `lib/notifications/resolve.ts`**
```ts
import { createAdminClient } from "@/lib/supabase/admin";
import type { NotificationRule, NotifyContext, ContextualRole } from "@/lib/notifications/types";

function roleValue(role: ContextualRole, ctx: NotifyContext): string | null {
  switch (role) {
    case "lead_agent": return ctx.lead?.agent_id ?? null;
    case "lead_closer": return ctx.lead?.closed_by ?? null;
    case "ticket_assignee": return ctx.ticket?.assigned_to ?? null;
    case "ticket_creator": return ctx.ticket?.created_by ?? null;
    case "feedback_submitter": return ctx.feedback?.user_id ?? null;
    default: return null;
  }
}
export function expandTargets(rule: NotificationRule, ctx: NotifyContext, deptMembers: Record<string, string[]>): string[] {
  if (!rule.enabled) return [];
  const ids = new Set<string>();
  for (const slug of rule.target_departments) for (const id of deptMembers[slug] ?? []) ids.add(id);
  for (const u of rule.target_users) ids.add(u);
  for (const role of rule.target_roles) { const v = roleValue(role, ctx); if (v) ids.add(v); }
  if (ctx.actorId) ids.delete(ctx.actorId);
  return [...ids];
}
/** DB wrapper: load the rule + the members of its target departments, then expand. */
export async function resolveRecipients(rule: NotificationRule, ctx: NotifyContext): Promise<string[]> {
  const deptMembers: Record<string, string[]> = {};
  if (rule.enabled && rule.target_departments.length) {
    const admin = createAdminClient();
    const { data: depts } = await admin.from("departments").select("id, slug").in("slug", rule.target_departments);
    const idToSlug = new Map((depts ?? []).map((d) => [d.id, d.slug]));
    const { data: mem } = await admin.from("department_members")
      .select("department_id, user_id, profiles!department_members_user_id_fkey(id)")
      .in("department_id", (depts ?? []).map((d) => d.id));
    for (const m of mem ?? []) {
      const slug = idToSlug.get((m as any).department_id); if (!slug) continue;
      (deptMembers[slug] ??= []).push((m as any).user_id);
    }
  }
  return expandTargets(rule, ctx, deptMembers);
}
```
Run → pass. Commit:
```bash
npx vitest run tests/notifyResolve.test.ts
git -C "D:/sed-lms-v2" add lib/notifications/resolve.ts tests/notifyResolve.test.ts
git -C "D:/sed-lms-v2" commit -m "feat: pure notification target resolver (departments+users+roles) + DB wrapper"
```

---

### Task 4: Rule reader + unified `notify`

**Files:** Create `lib/notifications/rules.ts`, `lib/notifications/notify.ts`.

- [ ] **Step 1: `lib/notifications/rules.ts`**
```ts
import { createAdminClient } from "@/lib/supabase/admin";
import type { NotificationRule } from "@/lib/notifications/types";
export async function getRule(eventKey: string): Promise<NotificationRule | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("notification_rules").select("*").eq("event_key", eventKey).maybeSingle();
  return (data as NotificationRule | null) ?? null;
}
export async function getAllRules(): Promise<NotificationRule[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("notification_rules").select("*");
  return (data ?? []) as NotificationRule[];
}
```

- [ ] **Step 2: `lib/notifications/notify.ts`**
```ts
import { createAdminClient } from "@/lib/supabase/admin";
import { eventDefault } from "@/lib/notifications/events";
import { getRule } from "@/lib/notifications/rules";
import { resolveRecipients } from "@/lib/notifications/resolve";
import type { NotifyContext } from "@/lib/notifications/types";

export async function notify(eventKey: string, ctx: NotifyContext,
  opts: { title: string; body: string; dedupKey: string; targetUrl?: string | null }): Promise<void> {
  const rule = await getRule(eventKey);
  if (!rule) return;
  const recipients = await resolveRecipients(rule, ctx);
  if (!recipients.length) return;
  const bell = eventDefault(eventKey)?.bell ?? "general";
  const deliverAfter = new Date(Date.now() + (rule.delay_minutes ?? 0) * 60_000).toISOString();
  const admin = createAdminClient();
  const rows = recipients.map((uid) => ({
    user_id: uid, event_key: eventKey, lead_id: ctx.leadId ?? null,
    title: opts.title, body: opts.body, dedup_key: `${opts.dedupKey}:${uid}`,
    target_url: opts.targetUrl ?? null, bell, deliver_after: deliverAfter,
  }));
  await admin.from("notifications").upsert(rows, { onConflict: "dedup_key", ignoreDuplicates: true });
}
```
(`eventDefault` must expose `bell` — confirm the events.ts type. `Date.now()` is fine in a route.)

- [ ] **Step 3: Typecheck + commit**
```bash
cd "D:/sed-lms-v2" && npx tsc --noEmit
git -C "D:/sed-lms-v2" add lib/notifications/rules.ts lib/notifications/notify.ts
git -C "D:/sed-lms-v2" commit -m "feat: notification rule reader + unified rule-driven notify()"
```

---

### Task 5: Refactor ticket + feedback notify to the engine

**Files:** Modify `lib/tickets/notify.ts`, `lib/feedback/notify.ts`, and their callers.

- [ ] **Step 1:** Rewrite `notifyTicket` to build a `NotifyContext` and call `notify`. New signature:
```ts
export async function notifyTicket(opts: {
  eventKey: "ticket_opened"|"ticket_assigned"|"ticket_resolved"|"ticket_reopened"|"ticket_overdue";
  ticketId: string; leadId: string;
  ticket?: { assigned_to: string | null; created_by: string | null } | null;
  lead?: { agent_id: string | null; closed_by: string | null } | null;
  actorId?: string | null;
  title: string; body: string; nonce: string;
}) {
  await notify(opts.eventKey,
    { leadId: opts.leadId, ticket: opts.ticket ?? null, lead: opts.lead ?? null, actorId: opts.actorId ?? null },
    { title: opts.title, body: opts.body, dedupKey: `${opts.eventKey}:${opts.ticketId}:${opts.nonce}`, targetUrl: `/tickets/${opts.ticketId}` });
}
```
Keep `techMembers()` (assignment picker) exported. Remove the old `recipients`/`settingsFor` path. Update the 5 call sites (`app/api/leads/[id]/tickets/route.ts`, `app/api/tickets/[id]/route.ts` ×3, `app/api/tickets/maintenance/route.ts`) to pass `ticket`/`lead`/`actorId` (the row data they already load) instead of `recipients`. E.g. `ticket_resolved`: pass `ticket:{created_by}, lead:{agent_id}` — the rule's `[ticket_creator,lead_agent]` roles reproduce today's recipients.

- [ ] **Step 2:** Same for `lib/feedback/notify.ts` — `notifyFeedback` becomes a `notify` wrapper (`feedback` ctx + `targetUrl:"/feedback"`); update the 2 feedback call sites to pass `feedback:{user_id}`/`actorId`. Keep `feedbackManagerIds` deletion (the `feedback_submitted` rule's `[tech,admin]` departments reproduce it).

- [ ] **Step 3: Build + commit**
```bash
cd "D:/sed-lms-v2" && npm run build
git -C "D:/sed-lms-v2" add lib/tickets/notify.ts lib/feedback/notify.ts "app/api/leads/[id]/tickets/route.ts" "app/api/tickets" "app/api/feedback"
git -C "D:/sed-lms-v2" commit -m "refactor: ticket + feedback notifications route through the rules engine"
```

---

### Task 6: Refactor the follow-up reminder poller

**Files:** Modify `app/api/notifications/generate/route.ts`.

- [ ] **Step 1:** Replace the per-user-settings logic with the rule: load `getRule("followup_reminder")`; if `!enabled` return `{created:0}`. Use `rule.delay_minutes` as the lead-time. For each eligible lead (Ready/Long-Term, agent, follow_up_time) where `shouldRemind(follow_up_time, rule.delay_minutes, now)`, insert a notification directly (via admin upsert) with `event_key:"followup_reminder"`, `bell:"general"`, `deliver_after: now`, recipient = the lead's `agent_id`, `dedup_key: followup_reminder:{lead_id}:{iso}:{agent_id}`, `target_url:/leads/{lead_id}`. (Recipient here is intrinsically the lead's agent; the rule's role list is informational for this poller.) Drop the `effectiveSetting`/`user_notification_settings` reads.

- [ ] **Step 2: Build + commit**
```bash
cd "D:/sed-lms-v2" && npx tsc --noEmit
git -C "D:/sed-lms-v2" add "app/api/notifications/generate/route.ts"
git -C "D:/sed-lms-v2" commit -m "refactor: follow-up reminder poller reads the notification rule (no per-user settings)"
```

---

## GROUP C — Two bells + inbox

### Task 7: notifications GET honours bell + deliver_after

**Files:** Modify `app/api/notifications/route.ts`.

- [ ] **Step 1:** Add `bell` to the select. Add `.lte("deliver_after", new Date().toISOString())` always (hide scheduled). Accept `?bell=website|general` → `.eq("bell", bell)` when present. Keep `?unread` + `limit 50`.
- [ ] **Step 2: Build + commit**
```bash
cd "D:/sed-lms-v2" && npx tsc --noEmit
git -C "D:/sed-lms-v2" add "app/api/notifications/route.ts"
git -C "D:/sed-lms-v2" commit -m "feat: notifications API filters by bell + deliver_after"
```

---

### Task 8: Two bell components + Topbar

**Files:** Create `components/layout/WebsiteBell.tsx`, `components/layout/GeneralBell.tsx`; modify `components/layout/Topbar.tsx`; (optionally delete `components/layout/NotificationBell.tsx`).

- [ ] **Step 1:** Build a shared bell that takes a `bell` prop + an icon (globe for website, bell for general) — fetch `GET /api/notifications?bell=<bell>&unread=1`, badge count, dropdown list (title/body/time, deep-link `target_url ?? (lead_id? /leads/…)`), mark-read (`POST /api/notifications/[id]/read`), mark-all (scope by refetch). Export `WebsiteBell = () => <BellBase bell="website" icon={Globe}/>` and `GeneralBell` similarly. Reuse the existing NotificationBell's fetch/render/mark-read logic but drop the pre-lead-follow-up + WGE-queue subsections (notification-backed only).
- [ ] **Step 2:** In `Topbar.tsx`, replace `<NotificationBell/>` with `<WebsiteBell/>` then `<GeneralBell/>` (website first). Remove the old import.
- [ ] **Step 3: Build + commit**
```bash
cd "D:/sed-lms-v2" && npm run build
git -C "D:/sed-lms-v2" add components/layout/WebsiteBell.tsx components/layout/GeneralBell.tsx components/layout/Topbar.tsx components/layout/NotificationBell.tsx
git -C "D:/sed-lms-v2" commit -m "feat: split header into Website + General notification bells"
```

---

### Task 9: `/notifications` inbox page

**Files:** Create `app/(app)/notifications/page.tsx`, `components/notifications/NotificationInbox.tsx`; modify `components/layout/Sidebar.tsx`.

- [ ] **Step 1: Page (server)** — auth; load the user's notifications via the RLS user client (`deliver_after <= now`, order created_at desc, limit ~200). Pass to `<NotificationInbox/>`.
- [ ] **Step 2: `NotificationInbox.tsx`** (`"use client"`) — a list of all notifications (title/body/time/bell tag/read-state), filters: bell (All/Website/General) + status (All/Unread), a "Mark all read" button, rows deep-link via `target_url`. `useRealtimeRefresh("notifications")`.
- [ ] **Step 3: Sidebar** — add `{ href:"/notifications", label:"Notifications" }` to `MAIN` (no perm — everyone). (Sidebar items require a `perm`; if so, pass a perm every user has, e.g. gate on nothing by making it always-visible — check the Sidebar's item shape and add an always-true entry consistent with the file.)
- [ ] **Step 4: Build + commit**
```bash
cd "D:/sed-lms-v2" && npm run build
git -C "D:/sed-lms-v2" add "app/(app)/notifications/page.tsx" components/notifications "components/layout/Sidebar.tsx"
git -C "D:/sed-lms-v2" commit -m "feat: /notifications inbox page + nav"
```

---

## GROUP D — New event hooks + Ready guard

### Task 10: Fire the four new events

**Files:** Modify `app/api/leads/route.ts` (lead_submitted), `app/api/pre-leads/route.ts` (prelead_submitted), `app/api/leads/[id]/route.ts` + `app/api/leads/[id]/follow-ups/route.ts` (website_ready + lead_status_changed).

- [ ] **Step 1: lead_submitted** — in the leads POST, after insert, best-effort `await notify("lead_submitted", { leadId: lead.id, lead: { agent_id: lead.agent_id, closed_by: null }, actorId: user.id }, { title:"New lead submitted", body: lead.business_name, dedupKey:\`lead_submitted:${lead.id}\`, targetUrl:\`/leads/${lead.id}\` })`.
- [ ] **Step 2: prelead_submitted** — pre-leads POST, after insert: `notify("prelead_submitted", { leadId:null, actorId:user.id }, { title:"New pre-lead submitted", body: preLead.business_name, dedupKey:\`prelead_submitted:${preLead.id}\`, targetUrl:\`/pre-leads/${preLead.id}\` })`.
- [ ] **Step 3: website_ready + lead_status_changed** — in BOTH `app/api/leads/[id]/route.ts` (PATCH) and `app/api/leads/[id]/follow-ups/route.ts` (POST, the `status_change` path): load the lead's CURRENT status before updating (both routes already load or can select it). After a successful status update where `newStatus !== oldStatus`:
  - always: `notify("lead_status_changed", { leadId:id, lead:{agent_id, closed_by}, actorId:user.id }, { title:"Lead status changed", body:\`${business_name} → ${newStatus}\`, dedupKey:\`lead_status_changed:${id}:${newStatus}:${nonce}\`, targetUrl:\`/leads/${id}\` })`.
  - if `newStatus === "Ready"`: `notify("website_ready", { leadId:id, lead:{agent_id, closed_by}, actorId:user.id }, { title:"Website ready", body:\`${business_name}'s website is ready\`, dedupKey:\`website_ready:${id}:${nonce}\`, targetUrl:\`/leads/${id}\` })`.
  Use `nonce = new Date().toISOString()`. Load `business_name` + `agent_id`/`closed_by` from the lead (select before/after update). Wrap in try/catch.
- [ ] **Step 4: Build + commit**
```bash
cd "D:/sed-lms-v2" && npm run build
git -C "D:/sed-lms-v2" add "app/api/leads/route.ts" "app/api/pre-leads/route.ts" "app/api/leads/[id]/route.ts" "app/api/leads/[id]/follow-ups/route.ts"
git -C "D:/sed-lms-v2" commit -m "feat: fire lead_submitted, prelead_submitted, website_ready, lead_status_changed"
```

---

### Task 11: Ready-guard 422 mapping

**Files:** Modify `app/api/leads/route.ts`, `app/api/leads/[id]/route.ts`, `app/api/leads/[id]/follow-ups/route.ts`, `app/api/admin/import/run/route.ts`.

- [ ] **Step 1:** At each place these routes `insert`/`update` `leads` (or run the follow-up status update / import insert), inspect the Supabase error: if `error && (error.code === "P0001" || /website link is required/i.test(error.message))`, return `NextResponse.json({ error: "A website link is required before a lead can be set to Ready." }, { status: 422 })` instead of a generic 500. (Postgres `raise exception` surfaces as PostgREST error; check both the message and code.) For the import route, collect such rows as failures in its per-row result rather than aborting the batch.
- [ ] **Step 2:** Confirm the client surfaces it: `StatusChangeModal.tsx` + `LeadDetail.tsx` inline edit already show `res.json().error` on non-ok — verify the 422 message renders (no code change likely needed; note if it does).
- [ ] **Step 3: Build + commit**
```bash
cd "D:/sed-lms-v2" && npm run build
git -C "D:/sed-lms-v2" add "app/api/leads/route.ts" "app/api/leads/[id]/route.ts" "app/api/leads/[id]/follow-ups/route.ts" "app/api/admin/import/run/route.ts"
git -C "D:/sed-lms-v2" commit -m "feat: map Ready-without-website_link trigger error to a friendly 422"
```

---

## GROUP E — Admin rules UI + retire per-user settings

### Task 12: Notification-rules API + retire per-user settings route

**Files:** Create `app/api/admin/notification-rules/route.ts`, `app/api/admin/notification-rules/[eventKey]/route.ts`; delete `app/api/admin/users/[id]/notification-settings/route.ts`.

- [ ] **Step 1: GET `/api/admin/notification-rules`** — gate `admin.notifications.manage`; return `getAllRules()` + the event catalog metadata (label/bell/availableRoles/timingMode) so the UI can render.
- [ ] **Step 2: PUT `/api/admin/notification-rules/[eventKey]`** — gate `admin.notifications.manage`; validate the eventKey is in the catalog; Zod-validate `{ enabled:boolean, target_departments:string[], target_users:string[](uuid), target_roles: <subset of the event's availableRoles>, delay_minutes:int>=0 }`; upsert on `event_key` (set `updated_by`,`updated_at`); `activity_log` `notification.rule.updated`. Return the saved rule.
- [ ] **Step 3:** Delete `app/api/admin/users/[id]/notification-settings/route.ts` (retired).
- [ ] **Step 4: Build + commit**
```bash
cd "D:/sed-lms-v2" && npx tsc --noEmit
git -C "D:/sed-lms-v2" add "app/api/admin/notification-rules" && git -C "D:/sed-lms-v2" rm "app/api/admin/users/[id]/notification-settings/route.ts"
git -C "D:/sed-lms-v2" commit -m "feat: admin notification-rules API; retire per-user notification-settings route"
```

---

### Task 13: Admin rules page + retire per-user settings UI

**Files:** Create `app/(app)/admin/notifications/page.tsx`, `components/admin/NotificationRules.tsx`; modify `components/layout/Sidebar.tsx`, `app/(app)/admin/users/[id]/page.tsx`; delete `components/admin/NotificationSettings.tsx`.

- [ ] **Step 1: Page (server)** — gate `admin.notifications.manage` (redirect else); load `getAllRules()` + the catalog + all users (id, display_name) + the 5 dept slugs; render `<NotificationRules .../>`.
- [ ] **Step 2: `NotificationRules.tsx`** (`"use client"`) — one card per event (grouped by bell): the event label + bell tag; an **Enabled** toggle; **Departments** chips (the 5 slugs, multi-toggle); **Users** multi-select; **Roles** chips (only the event's `availableRoles`); a **delay minutes** number input (labelled "minutes before" when `timingMode==="lead_time"`, "delay minutes" when `"delay"`, hidden when `"none"`). A per-card Save → `PUT /api/admin/notification-rules/${eventKey}` → inline saved state.
- [ ] **Step 3: Sidebar** — add `{ href:"/admin/notifications", label:"Notifications", perm:"admin.notifications.manage" }` to the `ADMIN` array.
- [ ] **Step 4: Retire per-user UI** — remove the `<NotificationSettings>` render (and its data load) from `app/(app)/admin/users/[id]/page.tsx`; delete `components/admin/NotificationSettings.tsx`.
- [ ] **Step 5: Build + commit**
```bash
cd "D:/sed-lms-v2" && npm run build
git -C "D:/sed-lms-v2" add "app/(app)/admin/notifications/page.tsx" components/admin/NotificationRules.tsx "components/layout/Sidebar.tsx" "app/(app)/admin/users/[id]/page.tsx" && git -C "D:/sed-lms-v2" rm components/admin/NotificationSettings.tsx
git -C "D:/sed-lms-v2" commit -m "feat: /admin/notifications rules page + nav; retire per-user settings UI"
```

---

## GROUP F — Verification

### Task 14: Full verification
- [ ] **Step 1:** `npx vitest run` (all green) + `npm run build` (green).
- [ ] **Step 2: Live (Chrome MCP)** against `npm run dev` (drive via `javascript_tool` fetch where header-bell clicks miss):
  1. `/admin/notifications` renders every event; edit `ticket_opened` to add the `management` department → open a ticket → confirm a management user now gets it (DB check).
  2. Two bells render in the header; a `website_ready` lands in the Website bell, a ticket event in the General bell (check `bell` column).
  3. Set a lead's `website_link` empty and try Ready → **422**; set the link + Ready → the owning agent gets a `website_ready` notification (Website bell).
  4. Submit a lead → `lead_submitted` to management+admin; submit a pre-lead → `prelead_submitted`.
  5. `/notifications` inbox lists everything with the bell/unread filters + mark-all-read.
  6. Set a rule's `delay_minutes=5` → firing that event yields a row with `deliver_after` ~5 min out, hidden from the bell until then.
- [ ] **Step 3:** Fix runtime issues, re-verify, commit.

---

## Self-review coverage map
- Rules table/columns/trigger/perm → Task 1; catalog+types → Task 2
- Resolver → Task 3; reader+notify → Task 4; fire-site refactor → Tasks 5,6
- Bells API/UI → Tasks 7,8; inbox → Task 9
- New events → Task 10; Ready guard 422 → Task 11
- Admin rules API+UI, retire per-user → Tasks 12,13
- Verify → Task 14
