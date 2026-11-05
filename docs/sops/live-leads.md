# Live leads — load once, then only what changed

Added 2026-11-05 (migrations 0097, 0098). This replaces "rebuild the whole
page on every change" on the leads screens: **Leads, HitList, Follow-ups, the
Dashboard, By Agent and the lead page.**

## Why

Before, one lead change made every open Leads / Follow-ups tab ask the server
to rebuild its whole page. The server re-read every lead the person can see
(about 1,000 rows, about 1.6 MB) each time. It did the same again on every
navigation after 30 seconds and on every reload. With many people working at
once, that was the database load and the slow pages. The Dashboard and the
lead page did not update by themselves at all.

## How it works now

1. **First visit:** the browser reads the person's leads once, straight from
   Supabase with their own session. Row-level security decides what they get,
   exactly as before. The copy is kept in memory for the tab and in IndexedDB
   for the next visit, so a reload opens instantly from it.
2. **A change anywhere:** a statement-level trigger on `leads` and on
   `lead_tag_links` broadcasts a tiny tick on the Realtime topic `lms:leads`.
   The tick says only which table changed. It carries no lead data.
3. **On a tick**, each open tab reads ONLY the rows changed since its last sync
   (`updated_at > cursor`, indexed) and patches them in place. Filters, sort,
   page and selection stay as they were. Your own save also syncs at once.
4. **Leads that leave a person's view** (reassigned away, moved to a status
   they can't see, hard-deleted) can't show up in a "changed since" read. A
   count check after each sync catches them, and the ids are reconciled.
5. **The lead page** checks just that lead's `updated_at` on a tick, and
   refreshes itself only when it moved or its tags changed.
6. **Sidebar badges** recount on the same tick.
7. **Follow-ups** (the Dashboard's pickup and follow-up numbers) are a second
   live copy of the same kind. Follow-ups are only ever added, so its cursor
   is `created_at`. It is saved as `followups:<user id>` and synced on a
   `lead_follow_ups` tick.
8. **Tickets** on the Dashboard are a small table: the page sends them, and
   the browser re-reads them on a `lead_tickets` tick
   (`hooks/useTickRefetch.ts`).

### Timing

| Event | What happens |
|---|---|
| A tick | Sync after 0.25 s plus up to 0.4 s of spread; a burst is one sync |
| Tab hidden | Nothing; one sync when it is looked at again |
| Window focus, tab visible again, back online | Sync if the last one is over 10 s old |
| Realtime socket reconnects | Sync, tags included |
| Safety floor while visible | A sync every 60 s (two tiny reads when nothing changed) |
| The overlap re-read | Each "changed since" read starts 2 minutes behind the cursor, so a transaction that committed late is never missed |

### The browser copy

- Keyed `leads:<user id>` in the IndexedDB database `sed-lms`.
- Thrown away and read afresh when the person's **permissions** change, when
  it is **older than 7 days**, or when the app's copy format changes.
- **Cleared on the sign-in page**, so a shared computer never keeps the
  previous person's leads.
- If IndexedDB is unavailable (private mode, full disk), the app works the
  same without it; only reloads are slower.

## Files

- `lib/leads/liveSync.ts`: the engine. It covers first read, delta, count
  check and reconcile, tags, the saved copy and the tick scheduler. It has no
  React or Supabase in it; it is tested with fakes in
  `tests/liveLeadsSync.test.ts`.
- `lib/leads/liveSource.ts`: the Supabase reads (browser client, RLS), the
  IndexedDB copy, and `clearLeadsCache()`.
- `lib/realtime/leadsTicks.ts`: one shared broadcast channel per tab.
- `hooks/useLiveLeads.ts`: one engine per tab, and its wiring to ticks,
  focus, reconnects and the 60 s floor. It also exports `syncLeadsNow()`,
  called after a lead save.
- `components/leads/LiveLeads.tsx`: `LiveLeadsTable`, `LiveFollowUpQueue`
  and the loading / error gate.
- `components/dashboard/LiveDashboardBoard.tsx` and
  `components/leads/LeadLiveRefresh.tsx`.
- The pages (`app/(app)/leads`, `hitlist`, `leads/follow-ups`, `dashboard`)
  no longer read the leads list on the server.
- `components/leads/ByAgentBoard.tsx`: By Agent on the live copy.
- `hooks/useTickRefetch.ts`: re-read a small table on its tick.
- `supabase/migrations/0097_leads_live_ticks.sql`: the tick triggers on
  `leads` and `lead_tag_links`, and the `updated_at` index.
  `0098_followups_tickets_live_ticks.sql` adds `lead_follow_ups` and
  `lead_tickets`.

## Still on the older pattern

Pre-leads, the Tickets queue and Feedback still refresh their page on a
change. Their tables are small, so this stays cheap. HitList star changes
also refresh the (now small) leads page. The Tickets queue applies its own
visibility rules on the server, so moving it to the browser needs those rules
first.

## When something goes wrong

| Symptom | Check |
|---|---|
| Changes from others take up to a minute | Ticks aren't arriving. Check that migration 0097's triggers exist (`trg_leads_live_tick`) and that Realtime is healthy. The 60 s floor keeps things correct meanwhile. |
| "Couldn't load the leads" | The first read failed (network or Supabase). *Try again* retries. |
| Someone sees a lead they shouldn't | Row-level security on `leads` decides. The browser copy is thrown away on any permission change. |
| Need to force everyone to re-read | Bump `CACHE_VERSION` in `lib/leads/liveSync.ts` and deploy. |
