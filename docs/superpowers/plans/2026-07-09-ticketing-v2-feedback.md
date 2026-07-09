# Ticketing v2 + Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-item screenshot attachments (upload-at-create), admin SLA due-dates + overdue escalation, resolved-ticket retention/auto-purge, a dashboard Feedback form (Open→Resolved), fix the lead-detail sticky-card overlap, add a lead-scoped tickets page, and always show both signature options.

**Architecture:** Extends the ticketing system. New private `ticket-attachments` bucket + `ticket_item_attachments` child table; SLA/retention config on the `app_settings` singleton; a secret-gated `/api/tickets/maintenance` poller (escalate overdue + purge old resolved). New lightweight `feedback` subsystem (table + `/feedback` page + 3 API routes). Pure logic in `lib/tickets/logic.ts` + `lib/feedback/` (TDD).

**Tech Stack:** Next.js 16 App Router + TS, Supabase (Postgres/RLS/Storage/service role), Zod, Vitest. Supabase project `ikuvbxjkoojtgekapbul`. Migrations written to `supabase/migrations/` AND applied to remote via Supabase MCP `apply_migration` (controller applies after review).

**Environment notes:**
- Windows; npm slow — use targeted `npx vitest run <file>` + `npx tsc --noEmit`; full `npm run build` at group ends.
- Playwright headless fails here → live verify via Claude-in-Chrome MCP.
- Writes via `createAdminClient()`; routes gate with `getUserPermissions(user.id)` + `perms.has(...)`.
- `department_members` embeds MUST pin `!department_members_user_id_fkey`.
- **Reference templates:** Storage upload/serve `lib/ai-tools/run.ts` (`persistGeneration`) + `app/(app)/ai-tools/generations/[id]/page.tsx`; poller `app/api/notifications/generate/route.ts` + `instrumentation.ts` + `lib/supabase/middleware.ts`; ticket routes `app/api/leads/[id]/tickets/route.ts`, `app/api/tickets/[id]/route.ts`; notify `lib/tickets/notify.ts`; settings `lib/settings/appSettings.ts` + `components/admin/AppSettingsCard.tsx` + `app/api/admin/settings/route.ts`; queue `components/tickets/TicketQueue.tsx`.

---

## GROUP A — Foundations

### Task 1: Migration 0018 — attachments, SLA/retention config, ticket columns, bucket

**Files:** Create `supabase/migrations/0018_ticket_v2.sql`.

- [ ] **Step 1: Write the SQL**

```sql
-- 0018_ticket_v2.sql — attachments, SLA/retention, due-date/escalation

create table if not exists public.ticket_item_attachments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.ticket_items(id) on delete cascade,
  path text not null,
  mime text,
  size int,
  created_at timestamptz not null default now()
);
create index if not exists ticket_item_attachments_item_idx on public.ticket_item_attachments (item_id);
alter table public.ticket_item_attachments enable row level security;
create policy "read ticket item attachments" on public.ticket_item_attachments for select to authenticated
  using (exists (
    select 1 from public.ticket_items ti
    join public.lead_tickets t on t.id = ti.ticket_id
    where ti.id = item_id));

alter table public.lead_tickets
  add column if not exists due_date timestamptz,
  add column if not exists escalated_at timestamptz;

alter table public.app_settings
  add column if not exists ticket_sla jsonb not null default '{"Low":168,"Normal":72,"High":24}',
  add column if not exists ticket_retention_days int not null default 0;

insert into storage.buckets (id, name, public)
values ('ticket-attachments', 'ticket-attachments', false)
on conflict (id) do nothing;
```

- [ ] **Step 2: Commit** (controller applies to remote after review)

```bash
git -C "D:/sed-lms-v2" add supabase/migrations/0018_ticket_v2.sql
git -C "D:/sed-lms-v2" commit -m "feat: migration 0018 - ticket attachments, SLA/retention config, due_date/escalated_at, bucket"
```

---

### Task 2: Migration 0019 — feedback table + permissions

**Files:** Create `supabase/migrations/0019_feedback.sql`; modify `supabase/seed.sql`.

- [ ] **Step 1: Write the SQL**

```sql
-- 0019_feedback.sql — dashboard feedback

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  type text not null check (type in ('Bug','Feature request','Other')),
  title text not null,
  description text,
  screenshot_path text,
  status text not null default 'Open' check (status in ('Open','Resolved')),
  resolution_note text,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists feedback_status_created_idx on public.feedback (status, created_at desc);
alter table public.feedback enable row level security;
create policy "read feedback own or manager" on public.feedback for select to authenticated
  using (user_id = auth.uid() or public.has_permission('feedback.manage'));

alter table public.feedback replica identity full;
do $$ begin alter publication supabase_realtime add table public.feedback; exception when duplicate_object then null; end $$;

insert into public.permissions (key, name, description, category, is_sensitive) values
  ('feedback.submit','Submit Feedback',null,'feedback',false),
  ('feedback.manage','Manage Feedback',null,'feedback',true)
on conflict (key) do nothing;
insert into public.department_permissions (department_id, permission_key)
  select d.id, k.key from public.departments d
  cross join (values ('feedback.submit'),('feedback.manage')) as k(key)
  where (d.slug, k.key) in (
    ('sales','feedback.submit'),('management','feedback.submit'),('support','feedback.submit'),
    ('tech','feedback.submit'),('tech','feedback.manage'),
    ('admin','feedback.submit'),('admin','feedback.manage')
  )
on conflict do nothing;
```

- [ ] **Step 2: Mirror into `supabase/seed.sql`** — read it; add the two `feedback.*` permission rows to the permissions block and the department-grant tuples above to its grant block (match the file's real `where (d.slug, p.key) in (...)` pattern).

- [ ] **Step 3: Commit**

```bash
git -C "D:/sed-lms-v2" add supabase/migrations/0019_feedback.sql supabase/seed.sql
git -C "D:/sed-lms-v2" commit -m "feat: migration 0019 - feedback table + feedback.submit/manage perms"
```

---

### Task 3: Types, permission constants, notification events

**Files:** Modify `lib/tickets/types.ts`, `lib/settings/appSettings.ts` (the `AppSettings` type), `lib/permissions/constants.ts`, `lib/notifications/events.ts`; create `lib/feedback/types.ts`.

- [ ] **Step 1: `lib/tickets/types.ts`** — add to `Ticket`: `due_date: string | null; escalated_at: string | null;`. Add to `TicketItem`: `attachments?: TicketAttachment[];` and export:
```ts
export interface TicketAttachment { id: string; item_id: string; path: string; mime: string | null; size: number | null; url?: string }
```

- [ ] **Step 2: `lib/settings/appSettings.ts`** — extend the `AppSettings` type with `ticket_sla: { Low: number; Normal: number; High: number }; ticket_retention_days: number;`, add both to the `getAppSettings` select, and to the lazy-seed default (`ticket_sla: { Low:168, Normal:72, High:24 }, ticket_retention_days: 0`).

- [ ] **Step 3: `lib/feedback/types.ts`** (create):
```ts
export const FEEDBACK_TYPES = ["Bug", "Feature request", "Other"] as const;
export const FEEDBACK_STATUSES = ["Open", "Resolved"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export interface Feedback {
  id: string; user_id: string | null; type: FeedbackType; title: string; description: string | null;
  screenshot_path: string | null; status: FeedbackStatus; resolution_note: string | null;
  resolved_at: string | null; resolved_by: string | null; created_at: string;
  user_name?: string; screenshot_url?: string;
}
```

- [ ] **Step 4: `lib/permissions/constants.ts`** — add `"feedback"` to `PERMISSION_CATEGORIES`; add `feedback.submit` (not sensitive) + `feedback.manage` (sensitive) to `PERMISSIONS`.

- [ ] **Step 5: `lib/notifications/events.ts`** — append three objects (hasTiming false, defaultLeadTimeMinutes 0):
```ts
  { key: "ticket_overdue", label: "Ticket overdue", description: "A ticket passed its due date and was escalated.", defaultLeadTimeMinutes: 0, hasTiming: false },
  { key: "feedback_submitted", label: "Feedback submitted", description: "A user submitted dashboard feedback.", defaultLeadTimeMinutes: 0, hasTiming: false },
  { key: "feedback_resolved", label: "Feedback resolved", description: "Your feedback was resolved.", defaultLeadTimeMinutes: 0, hasTiming: false },
```

- [ ] **Step 6: Typecheck + commit**

```bash
cd "D:/sed-lms-v2" && npx tsc --noEmit
git -C "D:/sed-lms-v2" add lib/tickets/types.ts lib/settings/appSettings.ts lib/feedback/types.ts lib/permissions/constants.ts lib/notifications/events.ts
git -C "D:/sed-lms-v2" commit -m "feat: types, appSettings SLA/retention, feedback types, perm constants, notification events"
```

---

## GROUP B — Pure logic + schema (TDD)

### Task 4: Ticket logic additions

**Files:** Modify `lib/tickets/logic.ts`, `lib/tickets/notify.ts` (event union); Test `tests/ticketsV2.test.ts`.

- [ ] **Step 1: Write failing tests** `tests/ticketsV2.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { slaDueDate, bumpPriority, isOverdue, retentionEligible } from "@/lib/tickets/logic";

describe("slaDueDate", () => {
  it("adds SLA hours for the priority", () => {
    const due = slaDueDate("High", { Low:168, Normal:72, High:24 }, "2026-07-09T00:00:00Z");
    expect(due).toBe("2026-07-10T00:00:00.000Z");
  });
});
describe("bumpPriority", () => {
  it("Low→Normal, Normal→High, High→High", () => {
    expect(bumpPriority("Low")).toBe("Normal");
    expect(bumpPriority("Normal")).toBe("High");
    expect(bumpPriority("High")).toBe("High");
  });
});
describe("isOverdue", () => {
  const now = new Date("2026-07-09T12:00:00Z");
  it("past due + not resolved = overdue", () => expect(isOverdue("2026-07-09T10:00:00Z", "In Progress", now)).toBe(true));
  it("resolved is never overdue", () => expect(isOverdue("2026-07-09T10:00:00Z", "Resolved", now)).toBe(false));
  it("future due is not overdue", () => expect(isOverdue("2026-07-09T20:00:00Z", "Open", now)).toBe(false));
  it("no due date is not overdue", () => expect(isOverdue(null, "Open", now)).toBe(false));
});
describe("retentionEligible", () => {
  const now = new Date("2026-07-09T00:00:00Z");
  it("resolved older than N days is eligible", () => expect(retentionEligible("Resolved", "2026-06-01T00:00:00Z", 30, now)).toBe(true));
  it("recent resolved is not", () => expect(retentionEligible("Resolved", "2026-07-08T00:00:00Z", 30, now)).toBe(false));
  it("non-resolved never eligible", () => expect(retentionEligible("In Progress", "2026-01-01T00:00:00Z", 30, now)).toBe(false));
  it("retention 0 = disabled", () => expect(retentionEligible("Resolved", "2026-01-01T00:00:00Z", 0, now)).toBe(false));
});
```

- [ ] **Step 2: Run → fail.** `npx vitest run tests/ticketsV2.test.ts`

- [ ] **Step 3: Implement in `lib/tickets/logic.ts`** (append):
```ts
import type { TicketPriority, TicketStatus } from "@/lib/tickets/types";

export function slaDueDate(priority: TicketPriority, sla: Record<TicketPriority, number>, createdAtISO: string): string {
  return new Date(new Date(createdAtISO).getTime() + (sla[priority] ?? 0) * 3_600_000).toISOString();
}
export function bumpPriority(p: TicketPriority): TicketPriority {
  return p === "Low" ? "Normal" : p === "Normal" ? "High" : "High";
}
export function isOverdue(dueDate: string | null, status: TicketStatus, now: Date): boolean {
  return !!dueDate && status !== "Resolved" && new Date(dueDate).getTime() < now.getTime();
}
export function retentionEligible(status: TicketStatus, resolvedAt: string | null, retentionDays: number, now: Date): boolean {
  if (status !== "Resolved" || retentionDays <= 0 || !resolvedAt) return false;
  return new Date(resolvedAt).getTime() < now.getTime() - retentionDays * 86_400_000;
}
```

- [ ] **Step 4:** In `lib/tickets/notify.ts`, add `"ticket_overdue"` to the `eventKey` union type.

- [ ] **Step 5: Run → pass. Commit**
```bash
npx vitest run tests/ticketsV2.test.ts && npx tsc --noEmit
git -C "D:/sed-lms-v2" add lib/tickets/logic.ts lib/tickets/notify.ts tests/ticketsV2.test.ts
git -C "D:/sed-lms-v2" commit -m "feat: ticket SLA/overdue/retention/bump logic + ticket_overdue event"
```

---

### Task 5: Schemas (ticket due_date + feedback)

**Files:** Modify `lib/tickets/schema.ts`; create `lib/feedback/schema.ts`, `tests/feedbackSchema.test.ts`.

- [ ] **Step 1: `lib/tickets/schema.ts`** — add to `createTicketSchema`: `due_date: z.string().datetime().nullable().optional(),`.

- [ ] **Step 2: Write failing tests** `tests/feedbackSchema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createFeedbackSchema, resolveFeedbackSchema } from "@/lib/feedback/schema";
describe("createFeedbackSchema", () => {
  it("valid", () => expect(createFeedbackSchema.safeParse({ type: "Bug", title: "Broken", description: "x" }).success).toBe(true));
  it("requires title", () => expect(createFeedbackSchema.safeParse({ type: "Bug", title: "" }).success).toBe(false));
  it("bad type", () => expect(createFeedbackSchema.safeParse({ type: "Nope", title: "x" }).success).toBe(false));
});
describe("resolveFeedbackSchema", () => {
  it("optional note", () => expect(resolveFeedbackSchema.safeParse({}).success).toBe(true));
});
```

- [ ] **Step 3: Run → fail. Implement `lib/feedback/schema.ts`:**
```ts
import { z } from "zod";
import { FEEDBACK_TYPES } from "@/lib/feedback/types";
export const createFeedbackSchema = z.object({
  type: z.enum(FEEDBACK_TYPES),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).nullable().optional(),
});
export const resolveFeedbackSchema = z.object({ resolution_note: z.string().trim().max(2000).nullable().optional() });
export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;
```

- [ ] **Step 4: Run → pass. Commit**
```bash
npx vitest run tests/feedbackSchema.test.ts && npx tsc --noEmit
git -C "D:/sed-lms-v2" add lib/tickets/schema.ts lib/feedback/schema.ts tests/feedbackSchema.test.ts
git -C "D:/sed-lms-v2" commit -m "feat: ticket due_date + feedback Zod schemas"
```

---

## GROUP C — Attachments (upload at create + serve)

### Task 6: Ticket POST accepts multipart + uploads attachments

**Files:** Modify `app/api/leads/[id]/tickets/route.ts`.

- [ ] **Step 1:** Change POST to read FormData. Replace the `await req.json()` parse with:
```ts
const form = await req.formData();
const payloadRaw = form.get("payload");
if (typeof payloadRaw !== "string") return NextResponse.json({ error: "invalid" }, { status: 422 });
const parsed = createTicketSchema.safeParse(JSON.parse(payloadRaw));
```
Keep the existing perm gate + eligibility + ticket insert (add `due_date: parsed.data.due_date ?? null` to the insert). After inserting items (each returns an id — use `.insert(itemRows).select("id, sort")`), for each item index collect `form.getAll(\`item_${sort}\`)` (File[]). For each File: validate `file.type.startsWith("image/")` and `file.size <= 5*1024*1024` (skip invalid); upload:
```ts
const path = `${ticket.id}/${item.id}/${file.name.replace(/[^\w.\-]/g, "_")}`;
await admin.storage.from("ticket-attachments").upload(path, file, { contentType: file.type, upsert: true });
await admin.from("ticket_item_attachments").insert({ item_id: item.id, path, mime: file.type, size: file.size });
```
(Wrap uploads in try/catch; a failed upload shouldn't 500 the whole create — collect a warning.) Keep the `ticket_opened` notification. Also update the GET to attach `attachments` per item: after loading items, load `ticket_item_attachments` for those item ids and group by `item_id`.

- [ ] **Step 2: Build + commit**
```bash
cd "D:/sed-lms-v2" && npx tsc --noEmit
git -C "D:/sed-lms-v2" add "app/api/leads/[id]/tickets/route.ts"
git -C "D:/sed-lms-v2" commit -m "feat: ticket create accepts multipart + uploads per-item image attachments"
```

---

### Task 7: Create modal — per-item image picker + FormData submit

**Files:** Modify `components/tickets/TicketModal.tsx`.

- [ ] **Step 1:** Change items state from `string[]` to `{ body: string; files: File[] }[]` (start `[{ body: "", files: [] }]`). Render each item row with the text input + an `<input type="file" accept="image/*" multiple>` whose `onChange` appends `Array.from(e.target.files)` to that item's `files` (show file-name chips + a remove-file control; enforce ≤5 files/item and ≤5 MB each client-side with an inline message). Keep "Add item"/"Remove item". On submit build FormData:
```ts
const nonEmpty = items.map((it, i) => ({ ...it, i })).filter((it) => it.body.trim());
if (!nonEmpty.length) { setItemsError("Add at least one change item."); return; }
const fd = new FormData();
fd.append("payload", JSON.stringify({ category, signature: signatureValue, priority, title: title.trim() || null, due_date: dueDate || null, items: nonEmpty.map((it) => it.body.trim()) }));
nonEmpty.forEach((it, sortIdx) => it.files.forEach((f) => fd.append(`item_${sortIdx}`, f)));
const res = await fetch(`/api/leads/${leadId}/tickets`, { method: "POST", body: fd }); // no Content-Type header
```
(NB: use the post-filter index `sortIdx` so file keys match the server's item `sort`.) Also add the due-date field here — see Task 11 (this task can leave `dueDate` state wired to a `<input type="datetime-local">`; Task 11 pre-fills it from SLA).

- [ ] **Step 2: Build + commit**
```bash
cd "D:/sed-lms-v2" && npx tsc --noEmit
git -C "D:/sed-lms-v2" add components/tickets/TicketModal.tsx
git -C "D:/sed-lms-v2" commit -m "feat: create modal per-item image picker + multipart submit"
```

---

### Task 8: Ticket page renders attachment thumbnails

**Files:** Modify `app/(app)/tickets/[id]/page.tsx`, `components/tickets/TicketDetail.tsx`.

- [ ] **Step 1: Page** — after loading items, load `ticket_item_attachments` (admin) for the item ids; for each, generate a signed URL: `const { data } = await admin.storage.from("ticket-attachments").createSignedUrl(att.path, 3600); att.url = data?.signedUrl`. Group by `item_id` and attach to each item as `attachments`. Pass through to `<TicketDetail>`.

- [ ] **Step 2: `TicketDetail.tsx`** — under each change item, if it has attachments, render a row of thumbnails (`<a href={url} target="_blank"><img src={url} className="h-16 w-16 object-cover rounded border border-border"/></a>`). No attachments → nothing.

- [ ] **Step 3: Build + commit**
```bash
cd "D:/sed-lms-v2" && npx tsc --noEmit
git -C "D:/sed-lms-v2" add "app/(app)/tickets/[id]/page.tsx" components/tickets/TicketDetail.tsx
git -C "D:/sed-lms-v2" commit -m "feat: render ticket item attachment thumbnails via signed URLs"
```

---

## GROUP D — SLA config, escalation/retention job, overdue UI

### Task 9: Settings card — SLA hours + retention days

**Files:** Modify `components/admin/AppSettingsCard.tsx`, `app/api/admin/settings/route.ts`.

- [ ] **Step 1: PUT route** — extend the Zod body with `ticket_sla: z.object({ Low: z.number().int().min(1), Normal: z.number().int().min(1), High: z.number().int().min(1) })` and `ticket_retention_days: z.number().int().min(0)`; include both in the upsert.

- [ ] **Step 2: `AppSettingsCard.tsx`** — add a "Tickets" section: three number inputs for SLA hours (Low/Normal/High) seeded from `initial.ticket_sla`, and one for `ticket_retention_days` (min 0, hint "0 = never auto-delete"). Include them in the PUT body. Keep the work-hours section.

- [ ] **Step 3: Build + commit**
```bash
cd "D:/sed-lms-v2" && npx tsc --noEmit
git -C "D:/sed-lms-v2" add components/admin/AppSettingsCard.tsx app/api/admin/settings/route.ts
git -C "D:/sed-lms-v2" commit -m "feat: admin settings for ticket SLA hours + retention days"
```

---

### Task 10: Maintenance job (escalate overdue + purge old resolved)

**Files:** Create `app/api/tickets/maintenance/route.ts`; modify `lib/supabase/middleware.ts`, `instrumentation.ts`.

- [ ] **Step 1: `app/api/tickets/maintenance/route.ts`** (`runtime="nodejs"`) — mirror `notifications/generate` secret gate (`x-wge-secret` === `WGE_PROCESSOR_SECRET`, else 401). Then with the admin client and `now = new Date()`:
  - **Escalate:** load overdue candidates `admin.from("lead_tickets").select("id, priority, status, assigned_to, lead_id, due_date, escalated_at").neq("status","Resolved").is("escalated_at", null).lt("due_date", now.toISOString())`. For each: `bumpPriority`, update `{ priority: bumped, escalated_at: now.toISOString() }`; load lead business_name; `await notifyTicket({ eventKey:"ticket_overdue", ticketId: t.id, leadId: t.lead_id, recipients: [...(await adminUserIds()), t.assigned_to].filter(Boolean), title:"Ticket overdue", body:\`${businessName} — escalated to ${bumped}\`, nonce: now.toISOString() })`.
  - **Retention:** `const settings = await getAppSettings();` if `ticket_retention_days > 0`: load resolved tickets `select("id").eq("status","Resolved").lt("resolved_at", new Date(now.getTime() - settings.ticket_retention_days*86400000).toISOString()).limit(200)`. For each: gather attachment paths (`admin.from("ticket_item_attachments").select("path, ticket_items!inner(ticket_id)").eq("ticket_items.ticket_id", id)` — or query items then attachments); `admin.storage.from("ticket-attachments").remove(paths)` (guard empty); `admin.from("notifications").delete().eq("target_url", \`/tickets/${id}\`)`; `admin.from("lead_tickets").delete().eq("id", id)` (cascades items+attachment rows).
  - Return `{ escalated, purged }` counts.

- [ ] **Step 2: `lib/supabase/middleware.ts`** — add `|| path === "/api/tickets/maintenance"` to the `isPublic` expression.

- [ ] **Step 3: `instrumentation.ts`** — inside the `started` guard, after the secret check (same as the WGE/notification pollers), add `setInterval(() => { fetch(\`${origin}/api/tickets/maintenance\`, { method:"POST", headers:{ "x-wge-secret": secret } }).catch(()=>{}); }, 300_000);`.

- [ ] **Step 4: Build + commit**
```bash
cd "D:/sed-lms-v2" && npm run build
git -C "D:/sed-lms-v2" add "app/api/tickets/maintenance/route.ts" lib/supabase/middleware.ts instrumentation.ts
git -C "D:/sed-lms-v2" commit -m "feat: tickets maintenance poller - overdue escalation + retention purge"
```

---

### Task 11: Due-date in create modal + Overdue badges

**Files:** Modify `components/tickets/TicketModal.tsx`, `app/(app)/leads/new/page.tsx`? (no) — instead pass SLA to the modal via `TicketsCard`; `components/tickets/TicketStatusChip.tsx` (add `OverdueBadge`); `components/tickets/{TicketsCard,TicketQueue,TicketDetail}.tsx`; `app/(app)/leads/[id]/page.tsx` + `app/(app)/tickets/page.tsx` (pass SLA / already have due_date).

- [ ] **Step 1: SLA → modal.** `TicketsCard` receives `sla` (the `app_settings.ticket_sla`) from the lead detail page (`getAppSettings()` in `app/(app)/leads/[id]/page.tsx`, pass `sla={settings.ticket_sla}` → `TicketsCard` → `TicketModal`). In `TicketModal`, when priority changes (or on mount), pre-fill the `dueDate` datetime-local from `slaDueDate(priority, sla, new Date().toISOString())` **unless the user has manually edited it** (track a `dueTouched` flag). Convert the ISO to the `datetime-local` value (local `YYYY-MM-DDTHH:mm`).

- [ ] **Step 2: `OverdueBadge`.** In `TicketStatusChip.tsx` add `export function OverdueBadge()` → a red `bg-dropped-bg text-dropped-fg` "Overdue" pill. Render it (guarded by `isOverdue(t.due_date, t.status, new Date())`) in `TicketsCard` rows, `TicketQueue` rows, and the `TicketDetail` header.

- [ ] **Step 3: Build + commit**
```bash
cd "D:/sed-lms-v2" && npx tsc --noEmit
git -C "D:/sed-lms-v2" add components/tickets/TicketModal.tsx components/tickets/TicketStatusChip.tsx components/tickets/TicketsCard.tsx components/tickets/TicketQueue.tsx components/tickets/TicketDetail.tsx "app/(app)/leads/[id]/page.tsx"
git -C "D:/sed-lms-v2" commit -m "feat: SLA-prefilled due date in create modal + Overdue badges"
```

---

## GROUP E — Feedback subsystem

### Task 12: Feedback notify helper + API routes

**Files:** Create `lib/feedback/notify.ts`, `app/api/feedback/route.ts`, `app/api/feedback/[id]/route.ts`.

- [ ] **Step 1: `lib/feedback/notify.ts`** — mirror `lib/tickets/notify.ts`: a `notifyFeedback({ eventKey, feedbackId, recipients, title, body, nonce })` that filters by `user_notification_settings` (`effectiveSetting`), upserts `notifications` rows with `target_url: "/feedback"` and `dedup_key: \`${eventKey}:${feedbackId}:${uid}:${nonce}\``, `lead_id: null`. Plus `feedbackManagerIds()` — union of members of depts holding `feedback.manage` (tech+admin): resolve via `department_permissions` join or reuse `adminUserIds()`+tech members. Simplest: query `department_members` for depts `in ('tech','admin')` (FK-pinned) and dedupe.

- [ ] **Step 2: `app/api/feedback/route.ts`** —
  - `POST` (multipart): gate `feedback.submit`; read FormData `payload` (JSON) → `createFeedbackSchema`; insert feedback row (`user_id: user.id, ...parsed, status:"Open"`); if a `screenshot` File is present + valid image ≤5 MB, upload to `ticket-attachments/feedback/${row.id}/${name}` and update `screenshot_path`; `activity_log` `feedback.created`; `notifyFeedback({ eventKey:"feedback_submitted", recipients: await feedbackManagerIds(), title:"New feedback", body:\`${type}: ${title}\`, nonce: row.created_at })`. Return `{ feedback }` 201.
  - `GET` (`?scope=mine|all`): `scope=all` requires `feedback.manage` (else 403); `mine` returns `user_id=user.id`. Load via admin, resolve submitter names, generate `screenshot_url` signed URLs. Return `{ feedback }`.

- [ ] **Step 3: `app/api/feedback/[id]/route.ts` PATCH** — gate `feedback.manage`; `resolveFeedbackSchema`; update `{ status:"Resolved", resolution_note, resolved_at: now, resolved_by: user.id }`; `activity_log` `feedback.resolved`; `notifyFeedback({ eventKey:"feedback_resolved", recipients:[feedback.user_id].filter(Boolean), title:"Feedback resolved", body: feedback.title, nonce: now })`. Return `{ feedback }`.

- [ ] **Step 4: Build + commit**
```bash
cd "D:/sed-lms-v2" && npx tsc --noEmit
git -C "D:/sed-lms-v2" add lib/feedback/notify.ts "app/api/feedback"
git -C "D:/sed-lms-v2" commit -m "feat: feedback notify helper + submit/list/resolve API"
```

---

### Task 13: Feedback page + components + nav

**Files:** Create `app/(app)/feedback/page.tsx`, `components/feedback/{FeedbackForm,FeedbackList}.tsx`; modify `components/layout/Sidebar.tsx`.

- [ ] **Step 1: Page (server)** — gate `feedback.submit` (else redirect `/dashboard`). Load the user's own feedback (`scope=mine` shape via admin) and, if `feedback.manage`, all feedback (with submitter names + screenshot signed URLs). Pass `{ mine, all (or null), canManage }` to a client wrapper.
- [ ] **Step 2: `FeedbackForm.tsx`** (`"use client"`) — type (RadioPillGroup Bug/Feature request/Other), title, description (textarea), one `<input type="file" accept="image/*">`. Submit multipart to `POST /api/feedback` (payload JSON + optional `screenshot` file), `router.refresh()`, clear.
- [ ] **Step 3: `FeedbackList.tsx`** — renders a list: for "mine" show type/title/status/created; for the manager queue show submitter name + a status filter + a **Resolve** control (opens a note, `PATCH /api/feedback/[id]`) + the screenshot thumbnail (signed URL). `useRealtimeRefresh("feedback")` on the manager queue.
- [ ] **Step 4: Sidebar** — add `{ href: "/feedback", label: "Feedback", perm: "feedback.submit" }` to `MAIN`.
- [ ] **Step 5: Build + commit**
```bash
cd "D:/sed-lms-v2" && npm run build
git -C "D:/sed-lms-v2" add "app/(app)/feedback/page.tsx" components/feedback "components/layout/Sidebar.tsx"
git -C "D:/sed-lms-v2" commit -m "feat: role-aware /feedback page (submit + manage) + nav"
```

---

## GROUP F — Fixes & small items

### Task 14: Overlap fix, lead-scoped tickets page, signature both

**Files:** Modify `components/leads/LeadDetail.tsx`, `components/leads/RecentFollowUps.tsx`, `components/tickets/TicketsCard.tsx`, `components/tickets/TicketModal.tsx`; create `app/(app)/leads/[id]/tickets/page.tsx`.

- [ ] **Step 1: Overlap fix.** In `RecentFollowUps.tsx` and `TicketsCard.tsx`, remove `sticky top-6 ` from the root className (keep the rest). In `LeadDetail.tsx`, change the `<aside className="hidden lg:block space-y-6">` to wrap both cards in a sticky container: `<aside className="hidden lg:block"><div className="sticky top-6 space-y-6"><RecentFollowUps/><TicketsCard/></div></aside>`.

- [ ] **Step 2: Signature both.** In `TicketModal.tsx`, replace `signatureOptions = hasCloser ? TICKET_SIGNATURES : (["Agent"] as const)` with `const signatureOptions = TICKET_SIGNATURES;` and `signatureValue` with just `signature`. Remove the `hasCloser` prop from `TicketModal`, `TicketsCard`, and the `hasCloser` plumbing in `LeadDetail.tsx` + `app/(app)/leads/[id]/page.tsx` (delete the now-unused prop; keep `tickets`).

- [ ] **Step 3: Lead-scoped tickets page.** Create `app/(app)/leads/[id]/tickets/page.tsx` (server): gate `tickets.view`; load the lead (business_name, status) + all its tickets (admin, with items/progress/assignee names — mirror `app/(app)/tickets/page.tsx`'s load, filtered `.eq("lead_id", id)`); render a header ("Tickets — {business_name}", back-link to the lead) + a status-grouped list (reuse `TicketQueue` passing the lead-scoped tickets, or a simple grouped list). In `TicketsCard.tsx`, change the "View all tickets" `href` from `/tickets?lead=${leadId}` to `/leads/${leadId}/tickets`.

- [ ] **Step 4: Build + commit**
```bash
cd "D:/sed-lms-v2" && npm run build
git -C "D:/sed-lms-v2" add components/leads/LeadDetail.tsx components/leads/RecentFollowUps.tsx components/tickets/TicketsCard.tsx components/tickets/TicketModal.tsx "app/(app)/leads/[id]/tickets/page.tsx" "app/(app)/leads/[id]/page.tsx"
git -C "D:/sed-lms-v2" commit -m "fix: sticky-card overlap; feat: lead-scoped tickets page; signature always both"
```

---

## GROUP G — Verification

### Task 15: Full verification
- [ ] **Step 1:** `npx vitest run` (all green) + `npm run build` (green).
- [ ] **Step 2: Live (Chrome MCP)** against `npm run dev` (note: harness clicks may miss sticky-sidebar buttons — drive via `javascript_tool` if a click no-ops, as in the ticketing verification):
  1. Open a ticket on a Ready lead with an item that has an uploaded screenshot → confirm the attachment row + the thumbnail renders on the ticket page (signed URL).
  2. In admin settings set SLA + retention; confirm the create modal pre-fills a due date; force a ticket's `due_date` into the past → hit `/api/tickets/maintenance` (with the secret) → confirm priority bumped, `escalated_at` set, `ticket_overdue` notification, and the **Overdue** badge.
  3. Submit feedback (+screenshot) as a user → a manager sees it in `/feedback` queue → Resolve → submitter gets `feedback_resolved`.
  4. Lead detail: cards no longer overlap on scroll; "View all tickets" → `/leads/[id]/tickets` lists all; signature shows **both** Agent + Closer.
- [ ] **Step 3:** Fix any runtime issues, re-verify, commit.

---

## Self-review coverage map
- Attachments → Tasks 1,3,6,7,8 · SLA/escalation → Tasks 1,3,4,9,10,11 · Retention → Tasks 1,4,10 · Feedback → Tasks 2,3,5,12,13 · Overlap fix → Task 14 · Lead tickets page → Task 14 · Signature → Task 14 · Events/perms → Tasks 2,3
