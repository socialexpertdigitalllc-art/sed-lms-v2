# Leads Follow-Up System — Design

**Date:** 2026-07-07
**Status:** Approved (conversationally) — full history/timeline, Pickup/No-Pickup entry, dedicated queue view, per-row signals.
**Branch:** `leads-followups` (off `polish-2`).

Leads currently only *store* a `follow_up_time` — there is no way to log a follow-up, no history, no queue. This builds a real follow-up system for leads (pre-leads already have a lighter one, untouched here).

---

## 1. Data model

### New table `lead_follow_ups` (migration 0013)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk default gen_random_uuid() | |
| `lead_id` | uuid not null → `leads(id)` on delete cascade | |
| `user_id` | uuid → `profiles(id)` on delete set null | who logged it |
| `fu_status` | text not null | `'Pickup'` or `'No Pickup'` (the "Follow Up status") |
| `comments` | text | Pickup only (long text) |
| `next_follow_up_time` | timestamptz | the scheduled next touch, if any |
| `status_change` | text | the new lead status set during this follow-up, if any (Pickup only) |
| `created_at` | timestamptz not null default now() | |

Indexes: `(lead_id, created_at desc)`.

### Denormalized columns on `leads` (same migration)

To keep the queue + row signals cheap (no per-row subqueries):

- `last_followup_status text` — `Pickup` / `No Pickup` / null
- `no_pickup_streak int not null default 0` — consecutive No-Pickups; reset to 0 on a Pickup
- (existing) `follow_up_time` — kept in sync to the latest follow-up's `next_follow_up_time` (the "current next follow-up"; may be null after a terminal Pickup)

### Permission

New `leads.followup` — "Log Lead Follow-ups" (category `leads`, not sensitive). Seeded to departments that have `pre_leads.followup` **or** `leads.edit` → sales + management + admin. Viewing logs/queue only needs `leads.view`.

### RLS

`lead_follow_ups` select policy scopes to visible leads:
```sql
create policy "read lead follow-ups" on public.lead_follow_ups
  for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));
```
(The subquery honors the leads RLS for the current user, so follow-ups are visible only for leads the user can see — including the category `cat_view` rules.) Inserts/updates happen via the service-role admin client behind API permission checks, matching the rest of the app. Add `lead_follow_ups` to the realtime publication + `replica identity full` for parity with other tables (optional; the UI also refreshes via `router.refresh`).

---

## 2. API

### `POST /api/leads/[id]/follow-ups` — log a follow-up
- Auth + `leads.followup`; the lead must be visible to the user (load via admin client, but 404 if the user-scoped client can't see it).
- Body (validated by Zod `logFollowUpSchema`):
  - `fu_status`: `"Pickup" | "No Pickup"` (required)
  - `next_follow_up_time`: optional ISO; **required when `fu_status = "No Pickup"`**; when present must be in the future.
  - `comments`: optional string (ignored unless Pickup)
  - `status_change`: optional status (ignored unless Pickup); if present, must be a valid `LEAD_STATUSES` value **and** the user must have `cat_set` for it (reuse `catSetKey`), else 403.
- Effects (service role, one logical operation):
  1. insert `lead_follow_ups` row (comments/status_change only stored for Pickup)
  2. update the lead: `follow_up_time = next_follow_up_time ?? null`, `last_followup_status = fu_status`, `no_pickup_streak = fu_status === "No Pickup" ? streak+1 : 0`, and `status = status_change` when provided
  3. `activity_log` `lead.followup_logged` (+ `lead.status_changed` semantics captured in new_value)
- Returns the created follow-up row.

### `GET /api/leads/[id]/follow-ups` — list a lead's log
- Auth + `leads.view`; RLS scopes; returns follow-ups desc by `created_at`, joined with the logger's `display_name`.

The queue page and detail page read follow-ups **server-side** (no client GET needed for initial render); the GET route backs the "See all" modal's lazy load if we choose to fetch on open (else the detail page passes all rows down).

---

## 3. Pure logic (`lib/leads/followups.ts`) — TDD

- `type FollowUpBucket = "overdue" | "today" | "upcoming" | "none"`.
- `bucketOf(followUpTime: string | null, now: Date): FollowUpBucket` — precise rule: `null` → `none`; `followUpTime < now` → `overdue`; `now ≤ followUpTime ≤ endOfToday(now)` → `today`; `followUpTime > endOfToday(now)` → `upcoming`.
- `groupByBucket(leads, now)` → `{ overdue, today, upcoming, none }` arrays, each sorted by `follow_up_time` asc (nulls last).
- `validateFollowUp(input, now)` → field-keyed errors: `fu_status` required; `next_follow_up_time` required + future when No Pickup; when Pickup + `next_follow_up_time` present it must be future (optional otherwise).
- `nextStreak(prev: number, fu_status)` → `No Pickup ? prev+1 : 0`.

---

## 4. UI

### 4a. Follow-Up entry modal (`components/leads/FollowUpModal.tsx`)
Data Console styled. Fields:
- **Follow Up status** — pill group `Pickup` / `No Pickup` (required).
- **No Pickup** branch → **Next Follow Up time** (datetime-local, required, future) → Submit.
- **Pickup** branch → **Follow Up Comments** (textarea) · **Next Follow Up time** (optional; required-looking but optional, becomes clearly optional when a terminal status is chosen) · **Status update** (select of `settableStatuses`, default "— keep current —").
- Efficiency rule: if `status_change` is terminal (`Closed`/`Dropped`), Next Follow Up time is optional and hint says "no next touch needed for a closed lead."
- On save → `POST …/follow-ups` → close + `router.refresh()`.

### 4b. Leads list ("card") — Follow Up button + row signals
- `LeadsTable`: add a **"Follow Up"** action button per row (gated `leads.followup`) opening `FollowUpModal` for that lead.
- Add row signals: a **Follow-up** column showing next follow-up time with an **overdue** flag (red) when past, and a small **last-outcome** chip (Pickup green / No Pickup amber) + **streak** badge (e.g. "×3") when `no_pickup_streak > 1`.

### 4c. Lead detail — sticky "Recent follow-ups"
- Restructure `LeadDetail` into a two-column layout: left = existing detail/edit; right = **sticky "Recent follow-ups"** panel.
- Panel shows the **3 most recent** follow-ups as compact cards (status chip, date, comments snippet / "No pickup", next follow-up). A **"Follow Up"** button at top opens the entry modal.
- **Click a card** → `FollowUpDetailModal` (full details of that one follow-up).
- **"See all follow-ups"** button → `FollowUpLogModal` (scrollable full list; each entry also opens the detail popup).
- The detail page loads the lead's follow-ups server-side and passes them down.

### 4d. Dedicated queue (`/leads/follow-ups`)
- Server component: fetch visible non-deleted leads (RLS-scoped), `groupByBucket`. Sections **Overdue** · **Due today** · **Upcoming** · **No follow-up set** with counts.
- Each row: business + status pill, next follow-up (overdue red), last outcome + streak, **Follow Up** button, link to the lead.
- Sidebar: add **"Follow-ups"** under the Leads group (gated `leads.view`), active-prefix matching.

### 4e. Modals inventory
`FollowUpModal` (entry), `FollowUpDetailModal` (one entry), `FollowUpLogModal` (all entries). Shared small `FollowUpCard` + a `FuStatusChip`.

---

## 5. Testing
- Unit: `bucketOf` / `groupByBucket` (boundary: exactly now, end of today, null), `validateFollowUp` (No-Pickup requires future time; Pickup optional; terminal status), `nextStreak`.
- Live (Chrome): log a No-Pickup (streak increments, next follow-up set, appears overdue/upcoming appropriately); log a Pickup with comments + status update (status changes, streak resets, comments in detail popup); recent panel shows 3 + "See all"; queue view groups correctly; row signals show overdue + streak. Build green, all tests pass.

---

## 6. Out of scope (deferred)
- Notifications/reminders (bell) — explicitly deferred to the notifications system.
- Pre-lead follow-ups are unchanged.
- Follow-up editing/deleting (logs are append-only for now).
