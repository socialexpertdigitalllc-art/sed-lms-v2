# Scaling & load balancing — why the LMS was slow and going down, and what changed

**Date:** 2026-10-23 · **Branch:** `men/inspiring-hypatia-uyysci`

## What was actually happening (measured on prod)

The app runs as **one Node process** on the Hostinger VPS, talking to a Supabase
database in Singapore (~300 ms per round-trip from the box). Three things
multiplied together as the team and the lead count grew:

| Finding | Evidence (24 h of prod logs / `pg_stat_statements`) |
|---|---|
| The `leads` read policy called `has_permission()` **per row** (2–3 sub-selects each) | plain "all leads" read: mean **556 ms** of pure DB time, 16k calls/day, the #1 DB consumer; follow-ups badge count 202 ms × 16k/day; spikes to 220 s |
| Every request re-verified the user and re-resolved permissions over the network | `/auth/v1/user` **16,400 calls/day** at ~300 ms; permission tables ~5,600 × 3 reads/day; mailbox lookup 5,500/day |
| One lead change made **every open tab** of every user re-render the whole server tree within 400 ms | `useRealtimeRefresh` → `router.refresh()`; N users × tabs × (12 queries + full leads payload) in one burst, on one thread |
| Screen switches rebuilt the page from the DB every time | Next ≥15 client cache is 0 s for dynamic pages unless configured |
| `leads` crossed **1,017 live rows** | PostgREST returns at most 1,000 rows per call — the tail was silently missing from every list page |

A single slow render on the single thread stalls everyone behind it; a burst of
twenty refreshes queues until the gateway returns 504 — that is the "stuck"
dashboard and the "crashes".

## What changed

### Database (already applied to prod, 2026-10-23)
`supabase/migrations/0094_leads_rls_initplan.sql` — `my_permission_keys()` yields
the caller's permission keys **once per statement**; the `read leads scoped`
policy tests membership in that set. Verified: identical visible rows for all
14 users over all 1,025 leads (0 mismatches).

| Query | Before | After |
|---|---|---|
| all leads, sales agent | 310 ms | **9.6 ms** |
| all leads, admin | ~500 ms | **13 ms** |
| follow-ups badge count | 202 ms | **7 ms** |

Rollback (if ever needed): re-run the policy block at the end of
`supabase/migrations/0070_closer_lead_visibility.sql`.

### Server (this release)
- **Verified user cached 60 s per token** (`lib/supabase/server.ts`): one GoTrue
  round-trip per person per minute instead of per request. A ban/deactivation
  takes effect within 60 s on each worker.
- **Permissions cached 30 s per user** (`lib/permissions/resolver.ts`); every
  admin write (overrides, department permissions, membership, SED AI expiry)
  invalidates, so changes are live at once on the worker that made them.
- **Mailbox lookup cached 60 s**, **IMAP unread count cached 45 s** per mailbox.
- **Layout reads run in parallel** (were four sequential hops).
- **Dashboard / by-agent select only the columns they use**
  (`lib/dashboard/columns.ts`) — ~1.5 KB/lead of comments, links, arrays no
  longer read, serialised and shipped per view.
- **All list pages page past 1,000 rows** (`lib/supabase/fetchAll.ts`).

### Browser (this release)
- `useRealtimeRefresh`: 1.5 s debounce + up to 1 s jitter, at most one refresh
  per 5 s per tab, **hidden tabs never refresh** (they catch up when looked at).
- Sidebar badge realtime bumps ignored while hidden.
- `experimental.staleTimes = { dynamic: 30 }`: switching Dashboard → Leads →
  Dashboard within 30 s reuses the payload already in the browser. A mutation
  or realtime event calls `router.refresh()`, which clears it, so changes
  still appear immediately.

### Where the LMS actually runs (checked via the Hostinger API, 2026-10-23)
`lms.sedsolutions.online` is a **Hostinger managed Node.js website** (hosting
account `u461699018`, app type `next`, Node 22), NOT a VPS. Hostinger builds
it from the GitHub repository on every push to `main` (Git auto-deployment)
and runs the Next.js server itself. There is no pm2 and no shell on that box.

What that means for "load balancing":
- The hosting runs **one Node process** for the site and we cannot add
  workers there. `ecosystem.config.cjs` (pm2 cluster) in this repo is ready
  for the day the LMS moves to a VPS or a Cloud plan; it is **not used** on
  the current hosting. `instrumentation.ts` already handles both cases.
- On shared Node.js hosting the "crashes" are the account hitting its
  resource limits (CPU, memory, IO, concurrent processes), after which the
  platform answers 503 until load drops. So on this platform the load
  balancing IS the work above: fewer and cheaper requests per person — far
  fewer auth and permission round-trips, a database policy 20–50× cheaper,
  no refresh herds from hidden tabs, no payload rebuilt on every screen
  switch. That is what stops the limits being hit.
- The next step up when the team grows again is a bigger hosting plan, or
  a VPS / Cloud plan where the pm2 cluster file applies and workers can be
  added one at a time.

## Deploy

Deploys are **Hostinger Node.js builds**. Two ways to start one:

1. **Push to `main`** — Git auto-deployment builds and publishes it (about
   4–6 minutes; the build list in hPanel → Websites → lms → Node.js shows it).
2. **From another branch** (what was done for this change on 2026-10-23):
   start a build through the Hostinger API / connector —
   `hosting_nodejs_start-build` with `source_type: git`, the repository
   `socialexpertdigitalllc-art/sed-lms-v2` and the branch — then poll
   `hosting_nodejs_build` until `completed`. A later push to `main` rebuilds
   from `main`, so a branch deploy must be merged into `main` to stick.

Environment variables live in hPanel (Node.js → Environment variables); a
build picks them up. Nothing in this change needs a new variable.
`WGE_POLLERS_DISABLED=1` stays set on every non-prod machine exactly as before.

## Verify after deploy

1. The Hostinger build for the commit shows `completed` and the site answers.
2. (VPS only) `pm2 ls` shows `sed-lms` in cluster mode, all workers online.
3. Dashboard total leads = `select count(*) from leads where deleted_at is null`
   (1,017 on 2026-10-23) — i.e. **more than 1,000**.
4. Open Leads, then Dashboard, then Leads again within 30 s: the second visits
   are instant (no server round-trip in the network tab).
5. Supabase → Logs → API: `/auth/v1/user` and `/rest/v1/department_members`
   volume should fall by roughly an order of magnitude within a day.

## Staleness contract (what "cached" means for people)

| Thing | Max lag on another worker | Lag on the worker that made the change |
|---|---|---|
| Permission change | 30 s | none |
| Ban / deactivate user | 60 s | 60 s (token-level cache) |
| Mailbox linked/unlinked | 60 s | none |
| Unread mail badge | 45 s | 45 s |
| Dashboard numbers after someone else's change | until the realtime refresh (≤ ~2.5 s, visible tabs) | same |

## Next steps when the team grows again

- Move the heavy pages to **server-side aggregates** (dashboard KPIs via a
  view / RPC, leads table via server pagination) so payload size stops
  scaling with the lead count.
- Supabase compute: the project is on the smallest tier; Auth is capped at 10
  DB connections (advisor). Upgrade before adding many more concurrent users.
- The `user_activity` table (170k rows / 44 MB) grows by ~2k rows a day;
  confirm the 90-day prune is running.
