# SED LMS v2 — Notification System (admin-configurable routing)

**Date:** 2026-07-09
**Branch:** `notification-system` (off `main` @ `2b2f5ad`)
**Status:** Design approved — ready for planning

Redesigns the notification subsystem from hardcoded recipients into a **data-driven, admin-configurable routing engine**, splits the header into **two bells**, adds a **notification inbox**, four **new events**, and a **DB-level Ready guard**. Builds on [[notifications-foundation]], [[ticketing-system]], [[ticketing-v2-feedback]].

## Goals (locked in brainstorming)
- Admin controls, **per event**, *who* is notified (departments + specific users + contextual roles) and *when* (instant or delayed).
- Two header bells: **Website** (globe icon — `website_ready`) and **General** (everything else).
- `website_link` **required** to move a lead to Ready; on that transition the owning agent is pinged (Website bell).
- **Fully admin-controlled** — the per-user opt-out matrix is retired.
- In-app only this phase; engine designed to add email/SMS/push later.
- A `/notifications` inbox page.

---

## 1. Rules engine (the core)

### Event catalog — `lib/notifications/events.ts`
Each `NOTIFICATION_EVENTS` entry gains:
- `bell: "website" | "general"` — which bell it shows in.
- `availableRoles: ContextualRole[]` — the contextual roles that make sense for this event (so the admin UI only offers relevant ones).
- `timingMode: "none" | "delay" | "lead_time"` — how `delay_minutes` is interpreted (`delay` = send N min after the event; `lead_time` = fire N min before a deadline, poller-driven; `none` = instant only).

`ContextualRole = "lead_agent" | "lead_closer" | "ticket_assignee" | "ticket_creator" | "feedback_submitter"`.

Full catalog (8 existing + 4 new):

| key | bell | availableRoles | timingMode |
|---|---|---|---|
| `followup_reminder` | general | lead_agent | lead_time |
| `website_ready` *(new)* | **website** | lead_agent, lead_closer | none |
| `lead_submitted` *(new)* | general | lead_agent | delay |
| `prelead_submitted` *(new)* | general | — | delay |
| `lead_status_changed` *(new)* | general | lead_agent, lead_closer | delay |
| `ticket_opened` | general | — | delay |
| `ticket_assigned` | general | ticket_assignee | delay |
| `ticket_resolved` | general | ticket_creator, lead_agent | delay |
| `ticket_reopened` | general | ticket_assignee | delay |
| `ticket_overdue` | general | ticket_assignee | delay |
| `feedback_submitted` | general | — | delay |
| `feedback_resolved` | general | feedback_submitter | delay |

### `notification_rules` table (migration 0020) — one row per event, admin-editable
`event_key text primary key`, `enabled boolean not null default true`, `target_departments text[] not null default '{}'` (dept slugs), `target_users uuid[] not null default '{}'`, `target_roles text[] not null default '{}'`, `delay_minutes int not null default 0`, `updated_at`, `updated_by`. RLS: select to all authenticated (the resolver reads it via service role anyway); writes service-role only.
**Seeded** from today's hardcoded routing so behaviour is unchanged until edited — e.g. `ticket_opened → {departments:['admin']}`, `ticket_assigned → {roles:['ticket_assignee']}`, `ticket_resolved → {roles:['ticket_creator','lead_agent']}`, `feedback_submitted → {departments:['tech','admin']}`, `followup_reminder → {roles:['lead_agent'], delay_minutes:15}`, and the new: `website_ready → {roles:['lead_agent']}`, `lead_submitted`/`prelead_submitted → {departments:['management','admin']}`, `lead_status_changed → {enabled:false}`.

### Resolver — `lib/notifications/resolve.ts`
```ts
type NotifyContext = {
  leadId?: string | null;
  lead?: { agent_id: string | null; closed_by: string | null } | null;
  ticket?: { assigned_to: string | null; created_by: string | null } | null;
  feedback?: { user_id: string | null } | null;
  actorId?: string | null; // excluded from recipients
};
async function resolveRecipients(eventKey, ctx): Promise<string[]>
```
Reads the rule (or the seeded default); if `!enabled` → `[]`. Expands `target_departments` → `department_members.user_id` (FK-pinned), unions `target_users`, unions contextual roles resolved from `ctx` (`lead_agent`=ctx.lead?.agent_id, `lead_closer`=ctx.lead?.closed_by, `ticket_assignee`=ctx.ticket?.assigned_to, `ticket_creator`=ctx.ticket?.created_by, `feedback_submitter`=ctx.feedback?.user_id), dedups, removes `ctx.actorId`. Pure target-expansion (given a rule + ctx + a dept→members map) is unit-tested; the DB reads are a thin wrapper.

### Unified `notify` — `lib/notifications/notify.ts`
```ts
async function notify(eventKey, ctx, { title, body, dedupKey, targetUrl, nonce }): Promise<void>
```
Resolves recipients, looks up the event's `bell` + rule `delay_minutes`, computes `deliver_after = now + delay_minutes` (instant when 0), and upserts one `notifications` row per recipient (`onConflict:"dedup_key", ignoreDuplicates:true`) with `bell` + `deliver_after`. Best-effort; never throws into a mutation.
**All existing fire-sites refactor to it:** `lib/tickets/notify.ts` (`notifyTicket`) and `lib/feedback/notify.ts` (`notifyFeedback`) become thin wrappers that build the `ctx` and call `notify`; the follow-up-reminder poller (`app/api/notifications/generate/route.ts`) reads the `followup_reminder` rule (enabled + `delay_minutes` as lead-time + roles) instead of per-user settings.

---

## 2. Two bells + inbox

- `notifications` gains **`bell text not null default 'general'`** (stamped from the event catalog at creation) and **`deliver_after timestamptz not null default now()`**. Index `(user_id, bell, read_at, created_at desc)`.
- `app/api/notifications/route.ts` GET accepts `?bell=website|general`; always filters `deliver_after <= now()`.
- **`components/layout/WebsiteBell.tsx`** (globe icon) + **`components/layout/GeneralBell.tsx`** (bell icon), both in `components/layout/Topbar.tsx`. Each fetches its `bell`, shows badge/unread, marks read (reuse `/api/notifications/[id]/read`, `all` scoped per bell). The existing `NotificationBell.tsx`'s ephemeral pre-lead-follow-up + WGE-generation subsections are **dropped** (the two bells are purely notification-backed; WGE status stays in WGE Control).
- **`app/(app)/notifications/page.tsx`** — inbox: all delivered notifications for the user (read + unread), a bell filter + unread filter, mark-all-read, deep-links via `target_url`. Sidebar nav `{ href:"/notifications", label:"Notifications" }` (no perm — everyone).

---

## 3. New events + fire hooks
- **`website_ready`** — fired at the interactive Ready-transition points (`app/api/leads/[id]/route.ts` PATCH and `app/api/leads/[id]/follow-ups/route.ts` POST) when the lead's status goes `!= 'Ready'` → `'Ready'` (compare loaded old status vs new). `notify("website_ready", { leadId, lead:{agent_id, closed_by}, actorId:user.id }, { title:"Website ready", body:\`${business_name}'s website is ready\`, targetUrl:\`/leads/${id}\`, dedupKey:\`website_ready:${id}:${uid}\`, nonce })`.
- **`lead_submitted`** — `app/api/leads/route.ts` after insert → `notify("lead_submitted", { leadId, lead, actorId:user.id }, {...targetUrl:/leads/{id}})`.
- **`prelead_submitted`** — `app/api/pre-leads/route.ts` after insert → `notify("prelead_submitted", { leadId:null, actorId:user.id }, {...targetUrl:/pre-leads/{id}})` (lead_id null).
- **`lead_status_changed`** — same two lead-status paths; on ANY status change → `notify("lead_status_changed", { leadId, lead, actorId }, { body:\`${business_name} → ${newStatus}\`, ... })`. (Off by default via its rule.)

## 4. `website_link` required for Ready (DB trigger)
Migration 0020:
```sql
create or replace function public.enforce_ready_website_link() returns trigger
language plpgsql as $$
begin
  if NEW.status = 'Ready' and (NEW.website_link is null or btrim(NEW.website_link) = '') then
    raise exception 'A website link is required before a lead can be set to Ready'
      using errcode = 'check_violation';
  end if;
  return NEW;
end $$;
create trigger trg_ready_website_link before insert or update on public.leads
  for each row execute function public.enforce_ready_website_link();
```
This covers **every** write path (status modal, inline edit, follow-up popup, new-lead, bulk import). The API routes that set status (`app/api/leads/route.ts`, `app/api/leads/[id]/route.ts`, `app/api/leads/[id]/follow-ups/route.ts`, `app/api/admin/import/run/route.ts`) detect the Postgres error (code `check_violation` / message) and return a **422** with the friendly message instead of a 500. The lead detail/status UIs surface it.

## 5. Admin control surface (replaces per-user settings)
- **`app/(app)/admin/notifications/page.tsx`** + `components/admin/NotificationRules.tsx` — one editable card per event: `enabled` toggle, **target departments** (chips of the 5 dept slugs), **target users** (multi-select from all users), **target roles** (chips from the event's `availableRoles`), **delay minutes** (labelled per `timingMode`), and a read-only **bell** label. Save → `PUT /api/admin/notification-rules/[eventKey]`. Gated by new perm **`admin.notifications.manage`** (dept admin). Sidebar nav under the admin group.
- API: `GET /api/admin/notification-rules` (all events + their rules) and `PUT /api/admin/notification-rules/[eventKey]` (upsert one rule; validate slugs/roles/uuids; `activity_log`).
- **Retire per-user settings:** remove `<NotificationSettings>` from `app/(app)/admin/users/[id]/page.tsx`, delete `app/api/admin/users/[id]/notification-settings/route.ts` + `components/admin/NotificationSettings.tsx`, and stop reading `user_notification_settings` (poller now reads the rule). The `user_notification_settings` table is left in place (dormant) — no destructive drop.

## DB / migrations
Migration **`0020_notification_rules.sql`**: `notification_rules` table (+ seeded default rows), `notifications.bell` + `notifications.deliver_after` columns (+ index), `enforce_ready_website_link()` + trigger, `admin.notifications.manage` perm (+ grant admin; mirror in `seed.sql`).

## Testing
- **Unit (Vitest):** pure target-expansion in `lib/notifications/resolve.ts` (departments + users + roles → deduped set, actor excluded, disabled→empty); `deliver_after` computation; the `bell` lookup.
- **Route:** notification-rules PUT validation/perm; the Ready-guard 422 mapping; each new event fires to the rule's recipients.
- **Live (Chrome MCP):** admin edits a rule on `/admin/notifications` (e.g. add a department to `ticket_opened`) → firing that event notifies the new recipient; two bells render + split correctly; mark `website_link` empty and try Ready → 422; set it + Ready → owning agent gets a Website-bell notification; `/notifications` inbox lists everything; a delayed rule lands in the future.

## Out of scope / deferred
Email/SMS/push channels (engine leaves room for a `channels` field on the rule); pre-lead follow-up reminders as a bell event; notification digests; per-user self-service prefs (intentionally removed — admin-only).

## Decisions (locked)
Hybrid routing (departments + users + contextual roles) via a seeded `notification_rules` table + a single resolver all fire-sites use; instant-with-optional-delay timing; fully admin-controlled (per-user matrix retired); two notification-backed bells (Website=`website_ready`, General=rest); 4 new events; `/notifications` inbox; a DB trigger enforcing `website_link` for Ready everywhere; in-app only, extensible to channels later.
