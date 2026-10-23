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

### Process model (this release) — the "load balancing"
`ecosystem.config.cjs` runs the server in **pm2 cluster mode**: several
workers on the same port, connections balanced between them by pm2. A slow
render occupies one worker while the others keep serving; a worker that leaks
memory is recycled alone (`max_memory_restart`) instead of the site going
down. `instrumentation.ts` runs the background pollers on **worker 0 only**.

## Deploy

```bash
cd /path/to/sed-lms-v2
git pull
npm ci
NODE_OPTIONS=--max-old-space-size=8192 npm run build
# first time only: move from the single process to the cluster
pm2 delete sed-lms
pm2 start ecosystem.config.cjs
pm2 save
# every later deploy:
pm2 reload sed-lms          # zero-downtime, one worker at a time
```

Worker count: default 2. Check headroom with `free -m` and `pm2 monit`; each
worker sits around 400–700 MB. Raise with `SED_LMS_INSTANCES=4 pm2 start
ecosystem.config.cjs` (or `max` = one per CPU) when RAM allows. Keep
`WGE_POLLERS_DISABLED=1` on every non-prod machine exactly as before.

The reverse proxy (nginx/Apache → `localhost:3000`) needs **no change** — the
cluster shares one port. If nginx is in front, these are worth having:

```nginx
upstream lms { server 127.0.0.1:3000; keepalive 32; }
location / {
  proxy_pass http://lms;
  proxy_http_version 1.1;
  proxy_set_header Connection "";
  proxy_read_timeout 120s;      # AI streams / uploads
  proxy_buffering off;          # streamed responses reach the browser as they are produced
}
```

## Verify after deploy

1. `pm2 ls` shows `sed-lms` with N instances, mode `cluster`, all `online`.
2. `pm2 logs sed-lms --lines 50` shows exactly one worker without the
   "pollers run on worker 0 only" line.
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
