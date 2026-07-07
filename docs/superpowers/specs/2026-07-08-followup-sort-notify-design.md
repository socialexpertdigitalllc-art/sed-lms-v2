# Lead Sorting, Follow-Up Rules & Notification Foundation — Design

**Date:** 2026-07-08
**Status:** Approved (conversationally). Decisions: follow-up time **always required**; notifications modeled as a **dedicated per-user settings table**; **in-app bell** delivery.
**Branch:** `followups-notify` (off `leads-followups`).

Four workstreams. A–C are small refinements to the just-built follow-up system; D starts the notification subsystem (foundation + the first event: the follow-up reminder). Other notification events come later.

---

## A. Lead sorting control

The leads list (`LeadsTable`) already sorts via TanStack (header clicks, default `created_at` desc). Add an explicit **"Sort by"** dropdown next to the existing filters with four options mapping to TanStack `SortingState`:

- **Follow-up time** → `follow_up_time` asc (soonest first; the working queue order)
- **Rating** → `rating` desc
- **Submitted date** → `created_at` desc (current default)
- **Alphabetical** → `business_name` asc

Selecting an option sets `setSorting([{ id, desc }])`. Header-click sorting still works. Default stays Submitted date. No API/schema change.

---

## B. Follow-up time always required

Per decision, the **Next Follow Up time** is required on **every** follow-up entry — both Pickup and No Pickup, including a Pickup that sets a terminal status. Changes:

- `lib/leads/followups.ts` `validateFollowUp`: require a future `next_follow_up_time` for **both** statuses (drop the Pickup-optional branch). Update its tests.
- `components/leads/FollowUpModal.tsx`: the Next Follow Up field is always shown + required; remove the terminal-status "optional" hint (it's always "Required").
- `app/api/leads/[id]/follow-ups/route.ts` POST: require a future `next_follow_up_time` regardless of `fu_status` (extend the existing No-Pickup guard to all).

Consequence: a Pickup that closes a lead still records a next time (harmless; the lead exits the follow-up set via C anyway).

---

## C. Follow-ups only for Ready / Long Term leads

The follow-up system applies **only to leads whose status is `Ready` or `Long Term`**. A shared helper `isFollowUpEligible(status): boolean` (in `lib/leads/followups.ts`, `FOLLOWUP_STATUSES = ["Ready", "Long Term"]`). Enforcement:

- **List** (`LeadsTable`): the "Follow Up" row button renders only when `isFollowUpEligible(row.status)` (in addition to `leads.followup`).
- **Detail** (`RecentFollowUps`): the "Follow Up" button shows only when the lead is eligible; the history/panel still renders (past follow-ups remain visible even if the lead later changes status).
- **Queue** (`/leads/follow-ups`): only include eligible leads (filter before `groupByBucket`). So the queue is the set of Ready/Long-Term leads bucketed by due-ness.
- **API** (`POST …/follow-ups`): 422 if the lead's **current** status isn't eligible (`"Follow-ups apply only to Ready or Long Term leads."`). (The status the follow-up may *set* is separate and still cat_set-checked.)

Edge: a Pickup can move a lead **out** of eligibility (e.g. → Closed) — allowed; it just won't appear in the queue afterward. A follow-up can't move a lead *into* an ineligible state and then be blocked, because the eligibility check is on the status *before* the update.

---

## D. Notification subsystem foundation + follow-up reminder

### Concept
A small, extensible notification system. **Events** are a code registry; per-user **settings** (enabled + timing) live in a table admins edit; fired **notifications** are rows the in-app bell shows. The first (and only, for now) event is `followup_reminder`.

### Event registry (`lib/notifications/events.ts`)
```ts
export const NOTIFICATION_EVENTS = [
  { key: "followup_reminder", label: "Follow-up reminder",
    description: "Remind the lead's agent before a scheduled follow-up.",
    defaultLeadTimeMinutes: 15, hasTiming: true },
] as const;
export type NotificationEventKey = (typeof NOTIFICATION_EVENTS)[number]["key"];
```
Future events append here; the settings UI + resolver iterate this list.

### Tables (migration 0014)
- **`notifications`**: `id`, `user_id → profiles (cascade)`, `event_key text`, `lead_id uuid null → leads (set null)`, `title text`, `body text`, `dedup_key text`, `created_at timestamptz default now()`, `read_at timestamptz null`. Unique index on `dedup_key` (prevents double-fire). Index `(user_id, read_at, created_at desc)`.
- **`user_notification_settings`**: `user_id → profiles (cascade)`, `event_key text`, `enabled bool not null default true`, `lead_time_minutes int not null default 15`, primary key `(user_id, event_key)`.
- **RLS:** `notifications` select `using (user_id = auth.uid())` (users read only their own; writes via service role). `user_notification_settings` select `using (user_id = auth.uid() or public.is_admin())`; writes via service role behind an admin API. (`is_admin()` already exists — used by profiles RLS.)

### Settings resolution (`lib/notifications/settings.ts`)
`effectiveSetting(userId, eventKey, rows)` → `{ enabled, leadTimeMinutes }`, falling back to the event's defaults when no row exists. Pure, unit-tested. `resolveSettings(userIds, eventKey)` batch-loads rows via admin client for the poller.

### Generation (poller)
- Secret-gated route **`POST /api/notifications/generate`** (reuses `WGE_PROCESSOR_SECRET`, exempted in `isPublic` like `/api/ai-tools/wge/process`). Logic (admin client):
  1. Load Ready/Long-Term, non-deleted leads with a non-null `follow_up_time`, `agent_id` set.
  2. Batch-load each agent's `followup_reminder` setting (enabled + lead time).
  3. For each lead whose agent's setting is **enabled**, if `now ≥ follow_up_time − leadTime` and `now < follow_up_time`, upsert a notification with `dedup_key = "followup_reminder:{lead_id}:{follow_up_time ISO}"` (ON CONFLICT DO NOTHING) → title `"Follow-up due soon"`, body `"{business_name} — follow up at {time}"`. The dedup_key ties the reminder to that specific scheduled time, so a reschedule (new `follow_up_time`) yields a fresh reminder and a past one never re-fires.
- **`instrumentation.ts`**: add a second `setInterval` (every 60s) hitting `/api/notifications/generate` with the secret (guarded by the same secret-configured check).

### Delivery — the bell (`components/layout/NotificationBell.tsx`)
- Add a fetch of **`GET /api/notifications?unread=1`** → the user's unread notifications. Show them as a top section ("Reminders") in the existing dropdown, alongside the current pre-lead/WGE items; the badge count includes them.
- Clicking a reminder navigates to the lead (`/leads/{lead_id}`) and marks it read (**`POST /api/notifications/[id]/read`**); an optional "Mark all read" marks the batch. Reminders link + clear like the other bell items.
- The bell already tolerates partial failures (pre-leads 403 hides that source only); the notifications fetch is independent and fails soft.

### Admin settings UI
- New **`GET/PUT /api/admin/users/[id]/notification-settings`** (admin-gated: requires `admin.users.create` or an appropriate admin perm — match how `admin/users/[id]/overrides` is gated). GET returns the user's rows; PUT upserts `{ event_key, enabled, lead_time_minutes }[]`.
- New section on **Admin → User** (`app/(app)/admin/users/[id]/page.tsx` loads the rows; a `NotificationSettings` component rendered within/after `UserManager`): a table of `NOTIFICATION_EVENTS` — each row an **enabled** toggle + (when `hasTiming`) a **minutes-before** number input, defaulting to the event default when unset. Save calls PUT. This is the "grant/revoke + timing per user" surface, and it lists every future event automatically.

---

## Testing
- **Unit:** sort-option→SortingState map (light); `validateFollowUp` always-required (updated); `isFollowUpEligible`; `effectiveSetting` fallback; the poller's due-window predicate extracted as a pure `shouldRemind(followUpTime, leadTime, now)` and tested (boundaries: exactly T−lead, exactly follow-up time, past).
- **Live (Chrome, admin):** sort dropdown reorders the list each way; follow-up modal rejects an empty time on both branches; "Follow Up" button absent on a Not Ready/Closed lead and present on Ready/Long-Term; queue shows only eligible leads; set a lead's follow-up ~2 min out with lead-time 15 → after the poller runs, the agent's bell shows the reminder; admin toggles the user's `followup_reminder` off → no new reminder; change minutes → window shifts. Build + all tests green.

## Out of scope (later, with the full notifications system)
- Additional events (overdue follow-up, lead assigned, WGE done as a first-class event, etc.).
- Email/SMS/push channels (no SMTP configured).
- User self-service notification preferences (admin-managed for now).
- Digest/batching, snooze, notification history page.
