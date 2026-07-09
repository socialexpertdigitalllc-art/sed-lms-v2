# Ticketing System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lead-linked ticketing system: Sales opens Changes/Improvement tickets (with a checkable list of change items) on Ready/Long-Term leads; Admin triages and assigns a dev; the dev works and resolves them; notifications flow open→admin, assigned→dev, resolved→sales, reopened→dev; plus a lead-detail card and a global queue.

**Architecture:** Mirror the lead follow-up system. Two tables (`lead_tickets`, `ticket_items`) written via the service-role admin client with in-code permission checks; pure logic in `lib/tickets/` (TDD); four notification events fired event-driven from the API; UI mirrors `RecentFollowUps`/`FollowUpModal`/`FollowUpQueue`.

**Tech Stack:** Next.js 16 App Router + TS, Supabase (Postgres/RLS/service role), Zod, Vitest. Supabase project `ikuvbxjkoojtgekapbul`. Migrations written to `supabase/migrations/` AND applied to remote via Supabase MCP `apply_migration` (controller does the apply).

**Environment notes:**
- Windows box; npm slow — use targeted `npx vitest run <file>` + `npx tsc --noEmit`; full `npm run build` only at group boundaries.
- Playwright headless fails here — live verify via Claude-in-Chrome MCP.
- `department_members` has two FKs to profiles → embeds MUST pin `!department_members_user_id_fkey`.
- Writes go through `createAdminClient()`; API enforces perms via `getUserPermissions(user.id)` then `perms.has(...)`.
- Reference templates: `app/api/leads/[id]/follow-ups/route.ts`, `lib/leads/{followups,followupSchema}.ts`, `components/leads/{RecentFollowUps,FollowUpModal,FollowUpQueue,FuStatusChip}.tsx`, `app/(app)/leads/follow-ups/page.tsx`, `lib/notifications/events.ts`, `app/api/notifications/generate/route.ts` (notification insert shape).

---

## GROUP A — Foundations

### Task 1: Migration 0017 — tables, permissions, notifications.target_url

**Files:** Create `supabase/migrations/0017_tickets.sql`; modify `supabase/seed.sql`.

- [ ] **Step 1: Write `0017_tickets.sql`**

```sql
-- 0017_tickets.sql — lead ticketing system

create table if not exists public.lead_tickets (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  category text not null check (category in ('Changes','Improvement')),
  signature text not null check (signature in ('Agent','Closer')),
  priority text not null default 'Normal' check (priority in ('Low','Normal','High')),
  status text not null default 'Open' check (status in ('Open','Assigned','In Progress','Resolved')),
  assigned_to uuid references public.profiles(id) on delete set null,
  title text,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null
);
create index if not exists lead_tickets_lead_created_idx on public.lead_tickets (lead_id, created_at desc);
create index if not exists lead_tickets_status_idx on public.lead_tickets (status);
create index if not exists lead_tickets_assigned_idx on public.lead_tickets (assigned_to);

create table if not exists public.ticket_items (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.lead_tickets(id) on delete cascade,
  body text not null,
  is_done boolean not null default false,
  done_at timestamptz,
  done_by uuid references public.profiles(id) on delete set null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ticket_items_ticket_sort_idx on public.ticket_items (ticket_id, sort);

alter table public.lead_tickets enable row level security;
alter table public.ticket_items enable row level security;
create policy "read tickets" on public.lead_tickets for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));
create policy "read ticket items" on public.ticket_items for select to authenticated
  using (exists (select 1 from public.lead_tickets t join public.leads l on l.id = t.lead_id where t.id = ticket_id));

-- generic deep-link for notifications (reusable by future events)
alter table public.notifications add column if not exists target_url text;

-- realtime for the live queue
alter table public.lead_tickets replica identity full;
alter table public.ticket_items replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.lead_tickets;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.ticket_items;
exception when duplicate_object then null; end $$;

-- permissions
insert into public.permissions (key, name, description, category, is_sensitive) values
  ('tickets.view','View Tickets',null,'tickets',false),
  ('tickets.create','Open Tickets',null,'tickets',false),
  ('tickets.assign','Assign Tickets',null,'tickets',true),
  ('tickets.resolve','Resolve Tickets',null,'tickets',false)
on conflict (key) do nothing;
insert into public.department_permissions (department_id, permission_key)
  select d.id, k.key from public.departments d
  cross join (values ('tickets.view'),('tickets.create'),('tickets.assign'),('tickets.resolve')) as k(key)
  where (d.slug, k.key) in (
    ('sales','tickets.view'),('sales','tickets.create'),
    ('tech','tickets.view'),('tech','tickets.resolve'),
    ('management','tickets.view'),('management','tickets.assign'),
    ('admin','tickets.view'),('admin','tickets.create'),('admin','tickets.assign'),('admin','tickets.resolve')
  )
on conflict do nothing;
```

- [ ] **Step 2: Mirror into `supabase/seed.sql`** — read it, add the four `tickets.*` permission rows to the permissions `insert ... values` block, and the same department-grant tuples to the grant block (match the file's exact format). Do NOT re-add `target_url`/tables there (seed only carries permissions + departments + grants).

- [ ] **Step 3: Commit** (controller applies the migration to the remote DB after review)

```bash
git -C "D:/sed-lms-v2" add supabase/migrations/0017_tickets.sql supabase/seed.sql
git -C "D:/sed-lms-v2" commit -m "feat: migration 0017 - lead_tickets, ticket_items, tickets perms, notifications.target_url"
```

---

### Task 2: Types, permission constants, notification events

**Files:** Create `lib/tickets/types.ts`; modify `lib/permissions/constants.ts`, `lib/notifications/events.ts`.

- [ ] **Step 1: `lib/tickets/types.ts`**

```ts
export const TICKET_CATEGORIES = ["Changes", "Improvement"] as const;
export const TICKET_SIGNATURES = ["Agent", "Closer"] as const;
export const TICKET_PRIORITIES = ["Low", "Normal", "High"] as const;
export const TICKET_STATUSES = ["Open", "Assigned", "In Progress", "Resolved"] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
export type TicketSignature = (typeof TICKET_SIGNATURES)[number];
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export interface TicketItem {
  id: string; ticket_id: string; body: string; is_done: boolean;
  done_at: string | null; done_by: string | null; sort: number; created_at: string;
}
export interface Ticket {
  id: string; lead_id: string; created_by: string | null;
  category: TicketCategory; signature: TicketSignature; priority: TicketPriority;
  status: TicketStatus; assigned_to: string | null; title: string | null;
  resolution_note: string | null; created_at: string; updated_at: string;
  resolved_at: string | null; resolved_by: string | null;
  items?: TicketItem[];
}
```

- [ ] **Step 2: `lib/permissions/constants.ts`** — add `"tickets"` to `PERMISSION_CATEGORIES`; add four entries to `PERMISSIONS` (`tickets.view`/`create`/`resolve` not sensitive, `tickets.assign` sensitive), matching the existing entry shape.

- [ ] **Step 3: `lib/notifications/events.ts`** — append four objects to `NOTIFICATION_EVENTS` (all `hasTiming:false, defaultLeadTimeMinutes:0`):

```ts
  { key: "ticket_opened", label: "Ticket opened (needs assignment)", description: "A sales user opened a ticket that needs an admin to assign a developer.", defaultLeadTimeMinutes: 0, hasTiming: false },
  { key: "ticket_assigned", label: "Ticket assigned to you", description: "An admin assigned a ticket to you.", defaultLeadTimeMinutes: 0, hasTiming: false },
  { key: "ticket_resolved", label: "Ticket resolved", description: "A developer resolved a ticket you opened.", defaultLeadTimeMinutes: 0, hasTiming: false },
  { key: "ticket_reopened", label: "Ticket reopened", description: "A resolved ticket assigned to you was reopened.", defaultLeadTimeMinutes: 0, hasTiming: false },
```

- [ ] **Step 4: Typecheck + commit**

```bash
cd "D:/sed-lms-v2" && npx tsc --noEmit
git -C "D:/sed-lms-v2" add lib/tickets/types.ts lib/permissions/constants.ts lib/notifications/events.ts
git -C "D:/sed-lms-v2" commit -m "feat: ticket types, permission constants, notification events"
```

---

## GROUP B — Pure logic + schema (TDD)

### Task 3: `lib/tickets/logic.ts` (pure) + tests

**Files:** Create `lib/tickets/logic.ts`, `tests/tickets.test.ts`.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { canTransition, itemProgress, isTicketEligible, dedupKey } from "@/lib/tickets/logic";

describe("canTransition", () => {
  it("Open→Assigned ok", () => expect(canTransition("Open", "Assigned")).toBe(true));
  it("Assigned→In Progress ok", () => expect(canTransition("Assigned", "In Progress")).toBe(true));
  it("In Progress→Resolved ok", () => expect(canTransition("In Progress", "Resolved")).toBe(true));
  it("Resolved→In Progress ok (reopen)", () => expect(canTransition("Resolved", "In Progress")).toBe(true));
  it("Open→Resolved rejected", () => expect(canTransition("Open", "Resolved")).toBe(false));
  it("Assigned→Assigned ok (reassign)", () => expect(canTransition("Assigned", "Assigned")).toBe(true));
});

describe("itemProgress", () => {
  it("counts done/total", () => {
    expect(itemProgress([{ is_done: true }, { is_done: false }, { is_done: true }] as any)).toEqual({ done: 2, total: 3 });
  });
  it("empty", () => expect(itemProgress([])).toEqual({ done: 0, total: 0 }));
});

describe("isTicketEligible", () => {
  it("Ready/Long Term eligible", () => { expect(isTicketEligible("Ready")).toBe(true); expect(isTicketEligible("Long Term")).toBe(true); });
  it("Not Ready ineligible", () => expect(isTicketEligible("Not Ready")).toBe(false));
});

describe("dedupKey", () => {
  it("includes event, ticket, recipient, nonce", () => {
    expect(dedupKey("ticket_assigned", "t1", "u1", "n1")).toBe("ticket_assigned:t1:u1:n1");
  });
});
```

- [ ] **Step 2: Run → fail.** `npx vitest run tests/tickets.test.ts`

- [ ] **Step 3: Implement `lib/tickets/logic.ts`**

```ts
import { isFollowUpEligible } from "@/lib/leads/followups";
import type { TicketStatus, TicketItem } from "@/lib/tickets/types";

const ALLOWED: Record<TicketStatus, TicketStatus[]> = {
  "Open": ["Assigned"],
  "Assigned": ["Assigned", "In Progress"],
  "In Progress": ["Resolved"],
  "Resolved": ["In Progress"], // reopen
};
export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}
export function itemProgress(items: Pick<TicketItem, "is_done">[]): { done: number; total: number } {
  return { done: items.filter((i) => i.is_done).length, total: items.length };
}
export function isTicketEligible(leadStatus: string): boolean {
  return isFollowUpEligible(leadStatus);
}
export function dedupKey(event: string, ticketId: string, userId: string, nonce: string): string {
  return `${event}:${ticketId}:${userId}:${nonce}`;
}
```

- [ ] **Step 4: Run → pass. Commit**

```bash
npx vitest run tests/tickets.test.ts
git -C "D:/sed-lms-v2" add lib/tickets/logic.ts tests/tickets.test.ts
git -C "D:/sed-lms-v2" commit -m "feat: pure ticket logic (transitions, progress, eligibility, dedup key)"
```

---

### Task 4: `lib/tickets/schema.ts` (Zod) + tests

**Files:** Create `lib/tickets/schema.ts`, `tests/ticketSchema.test.ts`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from "vitest";
import { createTicketSchema, ticketActionSchema } from "@/lib/tickets/schema";

describe("createTicketSchema", () => {
  const base = { category: "Changes", signature: "Agent", priority: "Normal", items: ["change one", "change two"] };
  it("accepts a valid ticket", () => expect(createTicketSchema.safeParse(base).success).toBe(true));
  it("requires at least one item", () => expect(createTicketSchema.safeParse({ ...base, items: [] }).success).toBe(false));
  it("rejects bad category", () => expect(createTicketSchema.safeParse({ ...base, category: "Nope" }).success).toBe(false));
});
describe("ticketActionSchema", () => {
  it("assign needs assigned_to", () => expect(ticketActionSchema.safeParse({ action: "assign", assigned_to: "11111111-1111-4111-8111-111111111111" }).success).toBe(true));
  it("resolve needs a note", () => expect(ticketActionSchema.safeParse({ action: "resolve", resolution_note: "done" }).success).toBe(true));
  it("resolve without note fails", () => expect(ticketActionSchema.safeParse({ action: "resolve" }).success).toBe(false));
  it("start/reopen need no extra", () => { expect(ticketActionSchema.safeParse({ action: "start" }).success).toBe(true); expect(ticketActionSchema.safeParse({ action: "reopen" }).success).toBe(true); });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement `lib/tickets/schema.ts`**

```ts
import { z } from "zod";
import { TICKET_CATEGORIES, TICKET_SIGNATURES, TICKET_PRIORITIES } from "@/lib/tickets/types";

export const createTicketSchema = z.object({
  category: z.enum(TICKET_CATEGORIES),
  signature: z.enum(TICKET_SIGNATURES),
  priority: z.enum(TICKET_PRIORITIES).default("Normal"),
  title: z.string().trim().max(200).nullable().optional(),
  items: z.array(z.string().trim().min(1)).min(1, "Add at least one change item"),
});

export const ticketActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), assigned_to: z.string().uuid() }),
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("resolve"), resolution_note: z.string().trim().min(1) }),
  z.object({ action: z.literal("reopen") }),
]);
export type CreateTicketInput = z.infer<typeof createTicketSchema>;
```

- [ ] **Step 4: Run → pass. Commit**

```bash
npx vitest run tests/ticketSchema.test.ts
git -C "D:/sed-lms-v2" add lib/tickets/schema.ts tests/ticketSchema.test.ts
git -C "D:/sed-lms-v2" commit -m "feat: ticket Zod schemas (create + action union)"
```

---

## GROUP C — Notifications helper + API routes

### Task 5: Ticket notification helper

**Files:** Create `lib/tickets/notify.ts`.

Server-only helper that resolves recipients (admin client), respects each recipient's `user_notification_settings`, and upserts notification rows. Read `app/api/notifications/generate/route.ts` for the exact insert shape + `lib/notifications/logic.ts` `effectiveSetting`.

- [ ] **Step 1: Implement `lib/tickets/notify.ts`**

```ts
import { createAdminClient } from "@/lib/supabase/admin";
import { effectiveSetting } from "@/lib/notifications/logic";
import { dedupKey } from "@/lib/tickets/logic";

type Recipient = string;

async function settingsFor(admin: ReturnType<typeof createAdminClient>, userIds: string[], eventKey: string) {
  const { data } = await admin.from("user_notification_settings").select("user_id, event_key, enabled, lead_time_minutes").in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]).eq("event_key", eventKey);
  const byUser = new Map((data ?? []).map((r) => [r.user_id, r]));
  return (uid: string) => effectiveSetting(eventKey, byUser.get(uid) ?? null);
}

export async function notifyTicket(opts: {
  eventKey: "ticket_opened" | "ticket_assigned" | "ticket_resolved" | "ticket_reopened";
  ticketId: string; leadId: string; recipients: Recipient[]; title: string; body: string; nonce: string;
}) {
  const admin = createAdminClient();
  const recipients = [...new Set(opts.recipients.filter(Boolean))];
  if (!recipients.length) return;
  const get = await settingsFor(admin, recipients, opts.eventKey);
  const rows = recipients
    .filter((uid) => get(uid).enabled)
    .map((uid) => ({
      user_id: uid, event_key: opts.eventKey, lead_id: opts.leadId,
      title: opts.title, body: opts.body,
      dedup_key: dedupKey(opts.eventKey, opts.ticketId, uid, opts.nonce),
      target_url: `/tickets/${opts.ticketId}`,
    }));
  if (rows.length) await admin.from("notifications").upsert(rows, { onConflict: "dedup_key", ignoreDuplicates: true });
}

/** Admin-department member ids (recipients for ticket_opened). */
export async function adminUserIds(): Promise<string[]> {
  const admin = createAdminClient();
  const { data: dept } = await admin.from("departments").select("id").eq("slug", "admin").single();
  if (!dept) return [];
  const { data } = await admin.from("department_members").select("user_id, profiles!department_members_user_id_fkey(id)").eq("department_id", dept.id);
  return (data ?? []).map((m: any) => m.user_id).filter(Boolean);
}

/** Tech-department members for the assignment picker. */
export async function techMembers(): Promise<{ id: string; display_name: string }[]> {
  const admin = createAdminClient();
  const { data: dept } = await admin.from("departments").select("id").eq("slug", "tech").single();
  if (!dept) return [];
  const { data } = await admin.from("department_members").select("user_id, profiles!department_members_user_id_fkey(id, display_name)").eq("department_id", dept.id);
  return (data ?? []).map((m: any) => ({ id: m.profiles?.id, display_name: m.profiles?.display_name })).filter((u: any) => u.id);
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd "D:/sed-lms-v2" && npx tsc --noEmit
git -C "D:/sed-lms-v2" add lib/tickets/notify.ts
git -C "D:/sed-lms-v2" commit -m "feat: ticket notification fan-out helper + dept member resolvers"
```

---

### Task 6: Per-lead ticket routes (list + create)

**Files:** Create `app/api/leads/[id]/tickets/route.ts`.

Mirror `app/api/leads/[id]/follow-ups/route.ts`.

- [ ] **Step 1: Implement**
  - `GET`: auth 401; gate `tickets.view` 403; load lead's tickets via the RLS user client (`.from("lead_tickets").select("*").eq("lead_id", id).order("created_at", desc)`), load their items via admin (`ticket_items` where `ticket_id in (...)`), resolve creator/assignee display names via admin `profiles`. Return `{ tickets }` (each with `items` + `created_by_name` + `assigned_to_name`).
  - `POST`: auth 401; gate `tickets.create` 403; load the lead; `if (!isTicketEligible(lead.status)) return 422` ("Tickets apply only to Ready or Long Term leads."); `createTicketSchema.safeParse` (422); insert the ticket via admin (`{ lead_id: id, created_by: user.id, category, signature, priority, title, status: "Open" }`), then insert `ticket_items` rows (`body`, `sort:index`); `activity_log` `ticket.created`; fire `notifyTicket({ eventKey:"ticket_opened", recipients: await adminUserIds(), title:"Ticket needs assignment", body:\`${category} — ${lead.business_name}\`, nonce: ticket.created_at, ... })`. Return `{ ticket }` 201.

- [ ] **Step 2: Build + commit**

```bash
cd "D:/sed-lms-v2" && npx tsc --noEmit
git -C "D:/sed-lms-v2" add "app/api/leads/[id]/tickets/route.ts"
git -C "D:/sed-lms-v2" commit -m "feat: per-lead ticket list + create API (fires ticket_opened)"
```

---

### Task 7: Global ticket routes (queue list, actions, item toggle)

**Files:** Create `app/api/tickets/route.ts`, `app/api/tickets/[id]/route.ts`, `app/api/tickets/[id]/items/[itemId]/route.ts`.

- [ ] **Step 1: `app/api/tickets/route.ts` GET** — gate `tickets.view`; load all tickets via admin (queue is cross-lead; admin read is fine since the page is gated), join each lead's `business_name` + `agent_id`, items (for progress), creator/assignee names. Support `?mine=1` (assigned_to = user) and `?status=`. Return `{ tickets }`.

- [ ] **Step 2: `app/api/tickets/[id]/route.ts` PATCH** — `ticketActionSchema.safeParse`; load the ticket + its lead. Branch on `action`:
  - `assign`: gate `tickets.assign`; `canTransition(status, "Assigned")` else 409; update `{ assigned_to, status: "Assigned", updated_at: now }`; `activity_log` `ticket.assigned`; `notifyTicket({ eventKey:"ticket_assigned", recipients:[assigned_to], title:"Ticket assigned to you", body:\`${category} — ${business_name}\`, nonce: now })`.
  - `start`: gate `tickets.resolve` AND (assignee === user OR admin); `canTransition(status,"In Progress")` else 409; update status; `activity_log` `ticket.started`.
  - `resolve`: gate `tickets.resolve`; `canTransition(status,"Resolved")` else 409; update `{ status:"Resolved", resolution_note, resolved_at: now, resolved_by: user.id }`; `activity_log` `ticket.resolved`; `notifyTicket({ eventKey:"ticket_resolved", recipients:[ticket.created_by, lead.agent_id], title:"Ticket resolved", body:\`${business_name} — ${resolution_note.slice(0,80)}\`, nonce: now })`.
  - `reopen`: gate `user===created_by OR perms.has("tickets.assign")`; `canTransition(status,"In Progress")` else 409; update status; `activity_log` `ticket.reopened`; `notifyTicket({ eventKey:"ticket_reopened", recipients:[ticket.assigned_to], ..., nonce: now })`.
  Use `now = new Date().toISOString()` as the nonce so re-actions re-notify. Return `{ ticket }`.

- [ ] **Step 3: `app/api/tickets/[id]/items/[itemId]/route.ts` PATCH** — gate `tickets.resolve`; body `{ is_done: boolean }`; update the item `{ is_done, done_at: is_done ? now : null, done_by: is_done ? user.id : null }`; return `{ item }`.

- [ ] **Step 4: Build + commit**

```bash
cd "D:/sed-lms-v2" && npx tsc --noEmit
git -C "D:/sed-lms-v2" add "app/api/tickets"
git -C "D:/sed-lms-v2" commit -m "feat: ticket queue list + action (assign/start/resolve/reopen) + item toggle APIs"
```

---

### Task 8: Notification bell honors target_url

**Files:** Modify `app/api/notifications/route.ts` (include `target_url` in the select) and `components/layout/NotificationBell.tsx` (link to `n.target_url ?? (n.lead_id ? \`/leads/${n.lead_id}\` : "#")`). Also add `target_url` to `AppNotification` in `lib/notifications/types.ts`.

- [ ] **Step 1:** Add `target_url` to the notifications select + type; update the bell's click/link target to prefer `target_url`. Keep the mark-read behavior.
- [ ] **Step 2: Build + commit**

```bash
cd "D:/sed-lms-v2" && npx tsc --noEmit
git -C "D:/sed-lms-v2" add app/api/notifications/route.ts components/layout/NotificationBell.tsx lib/notifications/types.ts
git -C "D:/sed-lms-v2" commit -m "feat: notification bell deep-links via target_url"
```

---

## GROUP D — UI

### Task 9: Chips + create modal + lead-detail card

**Files:** Create `components/tickets/TicketStatusChip.tsx`, `components/tickets/TicketModal.tsx`, `components/tickets/TicketsCard.tsx`; modify `components/leads/LeadDetail.tsx` and `app/(app)/leads/[id]/page.tsx`.

- [ ] **Step 1: `TicketStatusChip.tsx`** — small status pill (Open=gray, Assigned=blue, In Progress=amber, Resolved=green) + a priority badge helper. Mirror `FuStatusChip.tsx` styling/tokens.

- [ ] **Step 2: `TicketModal.tsx`** (client, mirror `FollowUpModal.tsx`) — props `{ leadId, hasCloser, onClose }`. Local state: category (RadioPillGroup Changes/Improvement), signature (RadioPillGroup Agent/Closer — disable "Closer" when `!hasCloser`), priority (RadioPillGroup), title (input), items (`DynamicList`, ≥1 non-empty required). Validate, `POST /api/leads/${leadId}/tickets` with `{ ...fields, items: nonEmpty(items) }`, `router.refresh()`, close.

- [ ] **Step 3: `TicketsCard.tsx`** (client, mirror `RecentFollowUps.tsx`) — props `{ leadId, leadStatus, hasCloser, tickets }`. Sticky card: header "Tickets" + **"New Ticket"** button gated `has("tickets.create") && isTicketEligible(leadStatus)`; body = `tickets.slice(0,3)` each showing `TicketStatusChip`, category, priority, `itemProgress` "N/M done", title/first-item snippet, linking to `/tickets/${t.id}`; footer **"View all (N)"** → `/tickets?lead=${leadId}` (queue filtered to lead). Uses `usePermissions()`.

- [ ] **Step 4: Embed in the lead detail** — in `components/leads/LeadDetail.tsx`, inside the existing right-column `<aside className="hidden lg:block">`, render `<TicketsCard .../>` as a sibling under `<RecentFollowUps .../>` (add `space-y-6` to the aside if needed). Add props `tickets` + `hasCloser` to `LeadDetail`. In `app/(app)/leads/[id]/page.tsx`, fetch the lead's tickets (+items) server-side (admin client, like `followUps`) and pass `tickets={tickets}` + `hasCloser={!!lead.closed_by}`.

- [ ] **Step 5: Build + commit**

```bash
cd "D:/sed-lms-v2" && npx tsc --noEmit
git -C "D:/sed-lms-v2" add components/tickets/TicketStatusChip.tsx components/tickets/TicketModal.tsx components/tickets/TicketsCard.tsx components/leads/LeadDetail.tsx "app/(app)/leads/[id]/page.tsx"
git -C "D:/sed-lms-v2" commit -m "feat: ticket status chip, create modal, lead-detail Tickets card"
```

---

### Task 10: Ticket detail page

**Files:** Create `app/(app)/tickets/[id]/page.tsx`, `components/tickets/TicketDetail.tsx`.

- [ ] **Step 1: Page (server)** — auth → `perms.has("tickets.view")` else redirect `/dashboard`. Load the ticket (admin) + items + lead (business_name, agent_id, closed_by, status) + creator/assignee/agent/closer names (admin `profiles` map). If `perms.has("tickets.assign")`, load `techMembers()` for the assignment picker. Pass everything + `{ canAssign, canResolve, isCreator }` to `<TicketDetail>`.

- [ ] **Step 2: `TicketDetail.tsx`** (client) — header (link to the lead, business name, category, priority, signature + resolved Agent/Closer name, `TicketStatusChip`); the **items list** with checkboxes (enabled when `canResolve`) → `PATCH /api/tickets/${id}/items/${itemId}` `{ is_done }` then `router.refresh()`; **assignment**: when `canAssign`, a dev `<select>` (from techMembers) + "Assign" → `PATCH /api/tickets/${id}` `{ action:"assign", assigned_to }`; **status actions** by role/state: "Start" (canResolve, status Assigned), "Resolve" (canResolve, status In Progress → opens a note textarea → `{ action:"resolve", resolution_note }`), "Reopen" (isCreator||canAssign, status Resolved → `{ action:"reopen" }`); show `resolution_note` when Resolved. Each action `router.refresh()`.

- [ ] **Step 3: Build + commit**

```bash
cd "D:/sed-lms-v2" && npx tsc --noEmit
git -C "D:/sed-lms-v2" add "app/(app)/tickets/[id]/page.tsx" components/tickets/TicketDetail.tsx
git -C "D:/sed-lms-v2" commit -m "feat: ticket detail page (items, assignment, status actions, resolution)"
```

---

### Task 11: Global ticket queue + nav

**Files:** Create `app/(app)/tickets/page.tsx`, `components/tickets/TicketQueue.tsx`; modify `components/layout/Sidebar.tsx`.

- [ ] **Step 1: Page (server)** — auth → `perms.has("tickets.view")` else redirect. Fetch all tickets via `GET`-style admin load (ticket + lead business_name/agent + items for progress + assignee names), pass `{ tickets, canAssign, canResolve, currentUserId, techMembers (if canAssign) }` + optional `?lead=`/`?mine=` initial filter to `<TicketQueue>`.

- [ ] **Step 2: `TicketQueue.tsx`** (client, mirror `FollowUpQueue.tsx`) — group tickets into **Open (unassigned) / Assigned / In Progress / Resolved**; each row: business name (link to lead), category + priority badges, `TicketStatusChip`, assignee name/avatar, `itemProgress` "N/M", created time, and a "View" link to `/tickets/${t.id}`. Controls: a status filter + an "Assigned to me" toggle (assigned_to === currentUserId). `useRealtimeRefresh("lead_tickets")` for live updates.

- [ ] **Step 3: Sidebar nav** — add `{ href: "/tickets", label: "Tickets", perm: "tickets.view" }` (place near Leads/Follow-ups or in its own group), matching the file's item shape.

- [ ] **Step 4: Build + commit**

```bash
cd "D:/sed-lms-v2" && npm run build
git -C "D:/sed-lms-v2" add "app/(app)/tickets/page.tsx" components/tickets/TicketQueue.tsx components/layout/Sidebar.tsx
git -C "D:/sed-lms-v2" commit -m "feat: global ticket queue + sidebar nav"
```

---

## GROUP E — Verification

### Task 12: Full verification

- [ ] **Step 1:** `npx vitest run` (all green) + `npm run build` (green).
- [ ] **Step 2: Live (Chrome MCP)** against `npm run dev`: as admin (has all perms), create a Changes ticket with 3 items on a Ready lead → confirm `ticket_opened` notification + the lead-card row (0/3). Assign a dev → `ticket_assigned`. Start → In Progress. Tick 2 items → card shows 2/3. Resolve with a note → `ticket_resolved` to creator/agent + status Resolved. Reopen → In Progress + `ticket_reopened`. Verify the queue grouping + realtime, the ticket page actions gate correctly, and the bell deep-links to `/tickets/{id}`.
- [ ] **Step 3:** Fix any runtime issues found, re-verify, commit.

---

## Self-review coverage map
- Tables/perms/target_url → Task 1; types/events → Task 2
- Transitions/progress/eligibility/dedup → Task 3; Zod → Task 4
- Notification fan-out → Task 5; per-lead create+list (ticket_opened) → Task 6; queue+actions+items (assigned/resolved/reopened) → Task 7; bell deep-link → Task 8
- Create modal + lead card → Task 9; detail page → Task 10; queue + nav → Task 11
- Build/tests/live → Task 12
