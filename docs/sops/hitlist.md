# HitList — runbook

Added 2026-10-24 (migration 0094). One company-wide list of premium leads,
each with a priority of 1 to 5 stars.

## Who can do what

| | Admin (`hitlist.manage` + `hitlist.view`) | Closer (`hitlist.view`) | Everyone else |
|---|---|---|---|
| See the golden stars in Leads | Yes | Yes | No |
| HitList tab | Yes | Yes (read-only) | No |
| Add, remove, re-rate | Yes | No | No |

Both permissions are granted by department (Admin, Closing). They can be given
to anyone else under **Admin → Permissions**.

## For users

- **Leads tab.** A star sits beside every business name.
  - Admins: click the empty star. A popup opens with 5 stars; one click on a
    star adds the lead with that priority (keys 1–5 work too, Esc closes).
  - Click the golden star to take the lead off the hit list. One click.
  - The golden star shows the priority number beside it.
  - Closers see only the golden stars, and can't change them.
- **Hit list filter** (Leads toolbar): *All hit list*, or one or more star
  levels (★★★★★ … ★☆☆☆☆), with counts.
- **Sort → Hit list priority** puts the most stars first.
- **HitList tab** (sidebar): the leads table with only the hit-listed leads,
  highest priority first. It has the same search, status tabs, filters, sort,
  saved views and CSV export as Leads, plus a **Priority** column. Admins
  re-rate a lead there with one click on a star. A closer sees every
  hit-listed lead they can see in Leads, not only their own.
- Changes show at once. The save runs behind the click; if it fails the star
  goes back and a message says why. Other people's screens update by
  themselves (realtime).

## How it works

- `supabase/migrations/0094_lead_hitlist.sql`: the `lead_hitlist` table (one
  row per lead: `priority` 1–5, `added_by`), RLS read for `hitlist.view`,
  realtime, the two permissions and their grants.
- `lib/hitlist/store.ts`: read the list, add / re-rate / remove. Each change is
  logged on the lead in `activity_log` (`lead.hitlist_added`,
  `lead.hitlist_priority`, `lead.hitlist_removed`).
- `app/api/hitlist/[leadId]/route.ts`: `PUT {priority}` and `DELETE`, both
  need `hitlist.manage`.
- `lib/leads/tableData.ts`: the data for both /leads and /hitlist.
- UI: `components/leads/HitlistStar.tsx` (star, popup, stars),
  `hooks/useHitlist.ts` (optimistic changes), and `LeadsTable` (`mode="hitlist"`
  for the tab).

## When something goes wrong

| Symptom | What to do |
|---|---|
| No stars or tab for admins | Apply migration 0094 (the permission grants at its end). |
| *Only admins can change the hit list.* | The user lacks `hitlist.manage`. |
| Stars don't appear on other screens until reload | Check the `lead_hitlist` table is in the `supabase_realtime` publication. |
