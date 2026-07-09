# SED LMS v2 — Ticketing System

**Date:** 2026-07-09
**Branch:** `ticketing-system` (off `main` @ `52aec35`)
**Status:** Design approved — ready for planning

## Context & pipeline

Company pipeline: a client signs up → a **Sales** user records them via the lead form (lead created, status `Not Ready`) → the **Tech** (development) team builds the website and moves the lead to `Ready` → Sales is notified → Sales gives the client the site URL and collects the changes the client wants. Sometimes Sales opens an improvement request on their own initiative before contacting the client.

Tickets capture that post-build change/improvement work. The system **mirrors the existing lead follow-up system** (see `docs/superpowers/specs/2026-07-07-leads-followup-system-design.md`): a lead-linked append-friendly record, a sticky card on the lead-detail right column, a create modal, and a dedicated queue — plus it hooks into the notification subsystem ([[notifications-foundation]]).

Two ticket **categories**: **Changes** (requested by the client) and **Improvement** (initiated by the sales person).

## Assignment flow (admin triage)

Sales opens a ticket → **Admins** are notified that a ticket needs assignment → an Admin assigns it to a specific **developer** (Tech) → that dev is notified, works it, and resolves it → the Sales creator (and the lead's agent) are notified it's resolved. If the client is still unsatisfied, Sales/Admin can **reopen**, re-notifying the assigned dev.

## Data model — migration `0017_tickets.sql`

### `public.lead_tickets`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `default gen_random_uuid()` |
| `lead_id` | uuid NOT NULL | `references leads(id) on delete cascade` |
| `created_by` | uuid | `references profiles(id) on delete set null` — the Sales user |
| `category` | text NOT NULL | check in (`'Changes'`,`'Improvement'`) |
| `signature` | text NOT NULL | check in (`'Agent'`,`'Closer'`) — who received the changes |
| `priority` | text NOT NULL | check in (`'Low'`,`'Normal'`,`'High'`), default `'Normal'` |
| `status` | text NOT NULL | check in (`'Open'`,`'Assigned'`,`'In Progress'`,`'Resolved'`), default `'Open'` |
| `assigned_to` | uuid | `references profiles(id) on delete set null` — the dev, null until assigned |
| `title` | text | optional short subject |
| `resolution_note` | text | set on resolve |
| `created_at` | timestamptz NOT NULL | `default now()` |
| `updated_at` | timestamptz NOT NULL | `default now()` |
| `resolved_at` | timestamptz | |
| `resolved_by` | uuid | `references profiles(id) on delete set null` |

Indexes: `(lead_id, created_at desc)`, `(status)`, `(assigned_to)`.

### `public.ticket_items`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `ticket_id` | uuid NOT NULL | `references lead_tickets(id) on delete cascade` |
| `body` | text NOT NULL | the change description (one discrete item) |
| `is_done` | boolean NOT NULL | default false |
| `done_at` | timestamptz | |
| `done_by` | uuid | `references profiles(id) on delete set null` |
| `sort` | int NOT NULL | default 0 |
| `created_at` | timestamptz NOT NULL | `default now()` |

Index: `(ticket_id, sort)`.

### RLS (mirrors `lead_follow_ups`)
Both tables RLS-enabled. SELECT policy: readable if you can see the parent lead (`exists (select 1 from leads l where l.id = lead_id)` for tickets; join through ticket for items). **No INSERT/UPDATE policies** — all writes go through the service-role admin client in the API, which enforces permissions in code. Add both tables to the `supabase_realtime` publication + `replica identity full` for the live queue.

### Notifications deep-link column
`0017` also `alter table public.notifications add column if not exists target_url text` (nullable, generic deep-link — reusable by all future events). The bell (`NotificationBell.tsx` / read route) prefers `target_url` when present, else falls back to the existing `lead_id ? /leads/{lead_id}` link. Ticket events set `target_url = '/tickets/{id}'` so the assigned dev lands directly on the ticket.

### Permissions (new category `tickets`)
Seed in `0017_tickets.sql` + `seed.sql` (mirror `leads.followup`), and add to `lib/permissions/constants.ts` (+ `"tickets"` in `PERMISSION_CATEGORIES`):
- `tickets.view` — see the card + ticket pages + queue. Grant: `sales`, `tech`, `management`, `admin`.
- `tickets.create` — open tickets. Grant: `sales`, `admin`.
- `tickets.assign` — assign a ticket to a dev. Grant: `admin`, `management`.
- `tickets.resolve` — start work, toggle items, resolve. Grant: `tech`, `admin`.

All are admin-grantable/revocable per user via the existing overrides UI.

## Lifecycle, guards & notifications

Statuses: **Open** (created, `assigned_to` null) → **Assigned** (admin sets `assigned_to`) → **In Progress** (dev starts) → **Resolved** (dev, with `resolution_note`). **Reopen** sends a Resolved ticket back to **In Progress** (keeps `assigned_to`).

Transition guards (pure `lib/tickets/logic.ts`, TDD):
- Create: caller has `tickets.create`; lead is eligible (`isFollowUpEligible(lead.status)` — Ready/Long-Term); ≥1 item.
- Assign (`Open`/`Assigned`→`Assigned`, set `assigned_to`): caller has `tickets.assign`.
- Start (`Assigned`→`In Progress`): caller has `tickets.resolve` (and is the assignee or admin).
- Toggle item done: caller has `tickets.resolve`.
- Resolve (`In Progress`→`Resolved`, requires `resolution_note`): caller has `tickets.resolve`.
- Reopen (`Resolved`→`In Progress`): caller is the creator or has `tickets.assign`.

Notification events — add to `lib/notifications/events.ts` (`hasTiming:false`, `defaultLeadTimeMinutes:0`); they auto-appear in the per-user settings matrix:
- `ticket_opened` → all **Admin**-dept users. dedup_key `ticket_opened:{ticketId}:{adminUserId}`.
- `ticket_assigned` → the **assigned dev**. dedup_key `ticket_assigned:{ticketId}:{assignee}:{assignCount}` (so re-assign re-notifies).
- `ticket_resolved` → the **creator** + the **lead's `agent_id`** (deduped if same). dedup_key `ticket_resolved:{ticketId}:{userId}`.
- `ticket_reopened` → the **assigned dev**. dedup_key `ticket_reopened:{ticketId}:{assignee}:{reopenCount}`.

Notifications are **event-driven** (inserted directly via the admin client at the moment of the action, respecting each recipient's `effectiveSetting(event, settingsRow)`), not poller-driven. Each ticket notification sets `lead_id` (context) and `target_url = '/tickets/{id}'` (deep-link). **Recipient sets are resolved via the admin client** (Admin-dept members for `ticket_opened`; the assignee; the creator/agent) — the two-FK PostgREST pin `!department_members_user_id_fkey` applies when reading department members.

## API routes (mirror the follow-up routes; all writes via admin client + `activity_log`)
- `GET /api/leads/[id]/tickets` — list a lead's tickets (+items, +resolved names). Gate `tickets.view`.
- `POST /api/leads/[id]/tickets` — create a ticket with items. Gate `tickets.create` + eligibility + ≥1 item (422s otherwise). Fires `ticket_opened`.
- `GET /api/tickets` — global queue list (filter by status/assignee/mine). Gate `tickets.view`.
- `PATCH /api/tickets/[id]` — actions by intent: `assign` (`tickets.assign`, fires `ticket_assigned`), `start` (`tickets.resolve`), `resolve` (`tickets.resolve` + note, fires `ticket_resolved`), `reopen` (creator/`tickets.assign`, fires `ticket_reopened`). Each guarded per the transition rules; validates the source→target transition.
- `PATCH /api/tickets/[id]/items/[itemId]` — toggle `is_done` (`tickets.resolve`), stamps `done_by`/`done_at`.

## UI (mirror follow-up components)
- **`components/tickets/TicketsCard.tsx`** — sticky card on the lead-detail right column, rendered under `RecentFollowUps` inside the existing `<aside>` in `components/leads/LeadDetail.tsx`. Shows the latest 3 tickets (status chip, category, priority, "N/M done" progress), a **"New Ticket"** button (gated `tickets.create` && `isFollowUpEligible(lead.status)`), and **"View all (N)"** → the ticket log/queue filtered to the lead. Detail page fetches the lead's tickets server-side and passes them in (like `followUps`).
- **`components/tickets/TicketModal.tsx`** — create modal: category (RadioPillGroup), signature (Agent/Closer — Closer disabled when `lead.closed_by` is null), priority (RadioPillGroup), optional title, and a `DynamicList` of change items (≥1 required). POSTs to `/api/leads/[id]/tickets`, then `router.refresh()`.
- **`app/(app)/tickets/[id]/page.tsx` + `components/tickets/TicketDetail.tsx`** — the ticket work view: header (business/lead link, category, priority, signature w/ resolved Agent/Closer name, status chip), the items list with checkboxes (dev toggles when `tickets.resolve`), assignment control (a dev `<select>` from Tech-dept members when `tickets.assign`), status actions per role (Start / Resolve+note / Reopen), and `resolution_note`.
- **`app/(app)/tickets/page.tsx` + `components/tickets/TicketQueue.tsx`** — global queue grouped **Open (unassigned) / Assigned / In Progress / Resolved**; each row: business, category, priority, assignee avatar, "N/M done", created; per-permission actions; a "Assigned to me" filter; `useRealtimeRefresh` on the tickets table. Sidebar nav entry `{ href: "/tickets", label: "Tickets", perm: "tickets.view" }`.
- Chips/helpers: `components/tickets/TicketStatusChip.tsx`, priority badge; `lib/tickets/types.ts` (`TICKET_CATEGORIES`, `TICKET_STATUSES`, `TICKET_PRIORITIES`, `SIGNATURES`, `Ticket`, `TicketItem`).

## Testing
- **Unit (Vitest):** `lib/tickets/logic.ts` (allowed transitions per status+permission, item-progress `doneCount/total`, create-eligibility, notification-recipient/dedup-key builders), Zod schema (`lib/tickets/schema.ts`).
- **Route-level:** create (403 without `tickets.create`, 422 on ineligible lead / no items), assign/start/resolve/reopen permission + transition guards (409 on invalid transition), item toggle.
- **Live (Chrome MCP):** full loop as different roles where feasible — Sales opens a Changes ticket with 3 items → Admin notified → Admin assigns a dev → dev notified → dev starts, ticks 2/3 items, resolves with a note → creator/agent notified → reopen → dev re-notified. Verify the lead-card progress, the queue grouping, and the bell.

## Out of scope / deferred
- Per-item reference URLs / screenshot attachments (v2).
- SLA/due-date timers and priority-based auto-escalation.
- Ticket comment threads (beyond the single `resolution_note`).
- Tickets on non-eligible (Not Ready/Closed/Dropped) leads.
- Pre-lead tickets (leads only).

## Decisions (locked in brainstorming)
Items are individually checkable (separate `ticket_items` table); statuses Open→Assigned→In Progress→Resolved + Reopen; assignment is admin-triaged (sales→admin→dev); tickets only on Ready/Long-Term leads; priority + optional title + resolution note included; ticket work view is a dedicated page.
