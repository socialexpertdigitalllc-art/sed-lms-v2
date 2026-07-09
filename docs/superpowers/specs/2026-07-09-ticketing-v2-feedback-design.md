# SED LMS v2 — Ticketing v2 + Feedback

**Date:** 2026-07-09
**Branch:** `ticketing-v2` (off `main` @ `0680557`)
**Status:** Design approved — ready for planning

Enhancements to the [[ticketing-system]] plus a new dashboard Feedback form. Builds on [[polish-3-signin-dup-addons]] (`app_settings` singleton, Supabase Storage pattern) and [[notifications-foundation]].

## Scope (7 items)
1. Per-change-item **screenshot attachments** (file uploads, at create time).
2. **SLA due-dates + overdue escalation** (admin SLA per priority, poller).
3. **Ticket retention** (admin auto-delete period for resolved tickets + their Storage files).
4. **Feedback form** (dashboard issues / feature requests → devs + admins; Open→Resolved).
5. **Overlap bug fix** (lead-detail right-column sticky cards collide).
6. **Lead-scoped tickets page** (`/leads/[id]/tickets`).
7. **Signature** always offers Agent + Closer.

---

## 1. Per-item screenshot attachments (file uploads, at create)

**Storage:** new **private** bucket `ticket-attachments` (mirror `ai-generations` in `0006`: `insert into storage.buckets (id,name,public) values ('ticket-attachments','ticket-attachments',false)`; no RLS policies — access only via the service-role admin client).

**Table:** `public.ticket_item_attachments` (`id uuid pk`, `item_id uuid → ticket_items on delete cascade`, `path text not null`, `mime text`, `size int`, `created_at timestamptz default now()`). RLS: read if you can see the parent ticket (join item→ticket→lead); writes service-role only.

**Create flow (multipart):** The create modal gains a **per-item image picker** (accept `image/*`, ≤5 MB each, ≤5 per item). On submit it sends **`multipart/form-data`**: a `payload` field (JSON: category, signature, priority, title, due_date, `items: string[]` bodies) + file parts named `item_{index}` (repeatable). The POST `app/api/leads/[id]/tickets/route.ts` switches to reading FormData: parse `payload` with `createTicketSchema`, create the ticket + items (as today), then for each item upload its files to `ticket-attachments/{ticketId}/{itemId}/{sanitizedName}` via `admin.storage.upload(..., { contentType, upsert:true })` and insert `ticket_item_attachments` rows. Validate type/size server-side; skip/return 422 on violation. Keep the ticket_opened notification.

**Serving:** the ticket page (`app/(app)/tickets/[id]/page.tsx`) loads attachment rows and generates **short-lived signed URLs** server-side — `admin.storage.from("ticket-attachments").createSignedUrl(path, 3600)` — passing `{name, url}` to `TicketDetail`, which renders thumbnails (`<img>` + click-to-open). (Signed-URL generation is net-new; no existing repo usage.)

**Types/schema:** `TicketItem` gains `attachments?: {id,path,mime,size}[]`; the client sends bodies as `string[]` (unchanged schema) with files out-of-band, so `createTicketSchema` only adds `due_date`.

---

## 2. SLA due-dates + overdue escalation

**SLA config:** extend the `app_settings` singleton with `ticket_sla jsonb not null default '{"Low":168,"Normal":72,"High":24}'` (hours per priority) — edited on the admin settings surface (`AppSettingsCard`, gated `admin.settings.manage`) via the existing `GET/PUT /api/admin/settings`. Reader `getAppSettings()` returns it.

**Columns:** `lead_tickets.due_date timestamptz` and `escalated_at timestamptz`.
- On create: `due_date = created_at + ticket_sla[priority] hours`, **pre-filled + overridable** by a datetime field in the create modal (sales can change it). Pure helper `slaDueDate(priority, sla, createdAt)` in `lib/tickets/logic.ts` (TDD).
- **Overdue** (derived, not stored): `due_date < now && status !== 'Resolved'`. Shown as a red **"Overdue"** badge on the card, queue, and ticket page.

**Escalation job:** new secret-gated `POST /api/tickets/maintenance` (mirror `notifications/generate`: `x-wge-secret` gate, `runtime="nodejs"`, add its exact path to `isPublic` in `lib/supabase/middleware.ts`), registered as a `setInterval` (~300 000 ms) in `instrumentation.ts` (inside the `started` guard, gated on the secret). For each overdue, non-resolved, **`escalated_at is null`** ticket: set `escalated_at = now`, **bump priority one level** (`Low→Normal→High`, capped) via pure `bumpPriority(p)`, and fire a new **`ticket_overdue`** notification (via `notifyTicket`) to `adminUserIds()` + the assignee. Escalates **once** per ticket (the `escalated_at is null` guard).

---

## 3. Ticket retention (auto-delete resolved tickets)

**Config:** `app_settings.ticket_retention_days int not null default 0` (**0 = never delete**), edited on the settings card.

**Cleanup** runs in the same `/api/tickets/maintenance` job: when `ticket_retention_days > 0`, find **Resolved** tickets with `resolved_at < now - retention_days`. For each: collect its `ticket_item_attachments.path`s (+ the `{ticketId}/` folder listing as a safety net), `admin.storage.from("ticket-attachments").remove(paths)` to free the files, delete the `lead_tickets` row (cascades `ticket_items` + `ticket_item_attachments`), and delete its notifications (`where target_url = '/tickets/{id}'`). Only **Resolved** tickets are purged — nothing Open/Assigned/In Progress is ever auto-deleted. Bounded per run (e.g. 200 tickets) with a `log`-style count.

---

## 4. Feedback form (Open → Resolved)

**Table:** `public.feedback` (`id`, `user_id → profiles` [submitter], `type text check in ('Bug','Feature request','Other')`, `title text not null`, `description text`, `screenshot_path text`, `status text check in ('Open','Resolved') default 'Open'`, `resolution_note text`, `resolved_at`, `resolved_by`, `created_at`). RLS: select own OR `has_permission('feedback.manage')`; writes service-role only. Realtime + replica identity full for the queue.

**Screenshot:** optional single image, uploaded (multipart) to `ticket-attachments/feedback/{feedbackId}/{name}`; served via signed URL on the manage view.

**Permissions (migration `0019` + seed):** `feedback.submit` (category `feedback`, granted to ALL departments) and `feedback.manage` (sensitive-ish, granted `tech`,`admin`).

**UI — `/feedback` page (role-aware):**
- Everyone (`feedback.submit`): a submit form (type, title, description, optional screenshot) + a list of **their own** submissions with status.
- `feedback.manage` holders additionally see the **full queue** (all feedback, filter Open/Resolved), each with a **Resolve** action (optional resolution note). `components/feedback/{FeedbackForm,FeedbackList,FeedbackQueue}.tsx`; `lib/feedback/{types,schema}.ts`.
- API: `POST /api/feedback` (submit, multipart; `feedback.submit`; fires `feedback_submitted`), `GET /api/feedback` (`?scope=mine|all`; `all` needs `feedback.manage`), `PATCH /api/feedback/[id]` (resolve; `feedback.manage`; fires `feedback_resolved`).
- Sidebar nav: `{ href: "/feedback", label: "Feedback", perm: "feedback.submit" }`.

**Notifications (new events):** `feedback_submitted` → `feedback.manage` holders (Tech+Admin); `feedback_resolved` → the submitter. Both `hasTiming:false`, slot into the per-user matrix. Fired event-driven via a small `lib/feedback/notify.ts` (mirrors `notifyTicket`; `target_url = '/feedback'`).

---

## 5. Overlap bug fix
In `components/leads/LeadDetail.tsx`, the right `<aside className="hidden lg:block space-y-6">` holds `RecentFollowUps` and `TicketsCard`, **both** with root `sticky top-6 …` → two same-top sticky siblings collide on scroll. Fix: wrap both in a single `<div className="sticky top-6 space-y-6">` and **remove `sticky top-6`** from each card's root (keep the rest of their classes). The column now pins as one unit.

## 6. Lead-scoped tickets page
New **`app/(app)/leads/[id]/tickets/page.tsx`** (route `/leads/{id}/tickets`; distinct from the detail route `/leads/{id}`) — gated `tickets.view`, loads the lead (business_name, status) + **all** its tickets (with items/progress/assignee names) via the admin client, renders the lead header + a status-grouped ticket list (reuse the `TicketQueue` grouping, scoped to the one lead). `TicketsCard`'s "View all tickets (N)" links here instead of `/tickets?lead=`.

## 7. Signature always both
`components/tickets/TicketModal.tsx` lines 38-39: replace `signatureOptions = hasCloser ? … : ["Agent"]` and `signatureValue = hasCloser ? … : "Agent"` with the unconditional `TICKET_SIGNATURES` / `signature`. Remove the now-dead `hasCloser` prop through `LeadDetail → TicketsCard → TicketModal`.

---

## DB/infra summary
- **Migration `0018`:** `ticket_item_attachments` table; `lead_tickets.due_date`/`escalated_at`; `app_settings.ticket_sla`/`ticket_retention_days`; `ticket-attachments` bucket. (Ticket perms already exist.)
- **Migration `0019`:** `feedback` table + `feedback.submit`/`feedback.manage` perms + realtime; mirrored in `seed.sql`.
- **Notification events** (`lib/notifications/events.ts`): `ticket_overdue`, `feedback_submitted`, `feedback_resolved`.
- `notifyTicket` eventKey union += `ticket_overdue`.
- `middleware.ts` `isPublic` += `/api/tickets/maintenance`.

## Testing
- **Unit (Vitest):** `slaDueDate`, `bumpPriority`, overdue predicate, retention-eligibility (resolved + age), feedback schema, ticket create-with-attachments schema/parse.
- **Route:** attachment upload validation (type/size), maintenance escalation+cleanup logic, feedback submit/resolve perms.
- **Live (Chrome MCP):** create a ticket with a screenshot on an item → thumbnail renders via signed URL; force a past due_date → maintenance escalates (priority bump + overdue badge + notification); submit feedback (+screenshot) → manager sees it in the queue → resolve → submitter notified; confirm the lead-detail cards no longer overlap; the lead tickets page lists all; signature shows both options.

## Out of scope / deferred
- URL-link attachments (files only, per decision); attachments added after create (create-time only).
- Feedback assignment/triage (simple Open→Resolved) and feedback retention (tickets only for now).
- Multi-file feedback screenshots (single image).

## Decisions (locked)
File-upload attachments only, at create time; child table for attachments; signed URLs for serving; SLA per priority (admin-configurable, overridable) on `app_settings`; overdue → flag + notify + one-time priority bump; retention purges Resolved tickets + Storage files after N days (0=off); feedback simple Open→Resolved with type+title+description+screenshot on a role-aware `/feedback` page; `feedback_resolved`→submitter event included.
