# Ticket Agent — AI website edits from a ticket, reviewed and deployed in the dashboard

**Date:** 2026-09-01
**Status:** Approved (design discussed and accepted by the operator on 2026-09-01)
**Engine decision:** Google Antigravity via the `agy` CLI in headless mode, running on the operator's Windows box, authenticated with the Google AI Pro account (socialexpertdigitalllc@gmail.com) so runs draw from the plan's Antigravity quota.

## 1. Problem

Today a website change request travels: sales user opens a ticket → developer reads it →
downloads the live site's files → edits them in an IDE (Antigravity) → uploads the result
back through the ticket screen. The download, upload, snapshot, and proof-of-work steps are
already built into the LMS; the middle — the editing — is manual and off-platform.

The feature: from a ticket, the developer clicks **Send to AI**. An Antigravity agent gets a
copy of the live site and the ticket text, makes the changes, and the dashboard shows its
progress in realtime. When it finishes, the developer reviews per-file diffs and a sandboxed
preview **in the dashboard**, and one click deploys the result to the live domain (snapshot
taken first). Nothing touches the hosting without human approval.

## 2. What already exists and is reused verbatim

| Step | Existing mechanism |
|---|---|
| Fetch live site files (dmviral subdomains AND Hostinger custom domains) | `fetchLiveSiteZip()` in `lib/site-studio/deploy/liveFiles.ts` — protected-domain refusal built in |
| Zip handling | `unzipToMap` / `zipFromMap` (`lib/template-engine/zip.ts`) — zip-slip guarded, root-stripping |
| Deploy with rollback | `snapshotSite()` + `overrideLiveSite()` + `prepareSiteZip()` (`lib/site-studio/deploy/*`) — snapshot-first, ticket-attributed `activity_log` proof (`studio.site.files_overridden`), restore route |
| Sandboxed preview | Site Builder's preview-route pattern: CSP `sandbox allow-scripts` **without** `allow-same-origin`, `untrustedContentHeaders()` |
| Permissions for "developer on a ticket" | `ALLOWED_PERMS` route pattern admitting `tickets.resolve | studio.manage` (same as the manual download/override buttons); developer = Tech dept member |
| Run-row concurrency discipline | `builder_runs`' CAS claim + ownership-token pattern (`generateRun.ts`) |
| Notifications & audit | `notify()` rules engine, `activity_log` dot-namespaced actions, ticket-page proof card |
| Ticket resolve nudge | Existing "resolve anyway?" nudge keyed on `studio.site.files_overridden` rows |

The genuinely new pieces: a run table, a worker that drives `agy`, DB-mediated progress, a
review/diff screen, and the approve/discard/revise routes.

## 3. Architecture

Two halves, joined only by the shared Supabase DB + storage (the Windows box's local LMS
already uses the prod DB):

```
PROD (Hostinger, lms.sedsolutions.online)          WINDOWS BOX (operator's machine)
─────────────────────────────────────────          ─────────────────────────────────
Ticket screen: "Send to AI"                        pm2 service `sed-agent-worker`
  └─ POST /api/tickets/[id]/agent-runs               loop: poll DB ~10s for queued runs
       validates ticket + host                        └─ CAS-claim run
       fetchLiveSiteZip → agent-sites/                └─ download original.zip → scratch dir
         {runId}/original.zip                         └─ run `agy -p "<task>" ...` in it
       insert site_agent_runs (queued)                └─ stream events → throttled row updates
                                                      └─ diff workspace vs original map
Dashboard run panel (2s poll)                         └─ upload result.zip → status review
  └─ GET /api/site-agent/runs/[id]                  heartbeat row every 60s
Review screen: diffs + iframe preview
  └─ GET .../preview/[[...path]], .../files/[path]
Approve → snapshot + overrideLiveSite (on prod,
  which reaches both hosting platforms) → deployed
```

Design consequences worth naming:

- **The worker never touches the hosting.** Prod fetches the site at run creation (it can
  reach both platforms; the worker cannot reach custom-domain files, which live on prod's
  local disk). The worker is purely a DB + storage client → **no new secret-authed prod
  routes, no `lib/supabase/middleware.ts` allowlist changes, no new shared secrets.**
- **Changed files come from a filesystem diff** (workspace after `agy` exits vs the original
  map), never from parsing agent output. The agent cannot misreport what it edited.
- **Realtime progress is DB-mediated** (the in-memory live registry can't span machines):
  the worker writes a throttled, tiny progress patch to the run row; the dashboard polls at
  2s exactly like Site Builder. Same UX, different plumbing.

## 4. Data model (migration `0071_site_agent_runs.sql`)

```sql
create table site_agent_runs (
  id            uuid primary key default gen_random_uuid(),
  ticket_id     uuid references lead_tickets(id) on delete set null,  -- survives retention purge
  lead_id       uuid references leads(id) on delete set null,
  site_host     text not null,          -- bound + validated at creation, immutable
  status        text not null default 'queued'
                check (status in ('queued','running','review','deploying','deployed','failed','discarded')),
  claim_id      uuid,                   -- ownership token, generation_id discipline
  conversation_id text,                 -- agy --conversation id, for the revise loop
  instructions  text,                   -- extra developer instructions (revise), appended to task
  files         jsonb not null default '{}'::jsonb,  -- SMALL: {path: {action: 'edit'|'create'|'delete', bytes: n}}
  output_tail   text,                   -- last ≤2KB of agent output, progress display only
  summary       text,                   -- agent's final response text (trimmed)
  usage         jsonb,                  -- whatever agy reports (tokens etc), best-effort
  error         text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index site_agent_runs_one_active_per_ticket
  on site_agent_runs (ticket_id)
  where status in ('queued','running','review','deploying');
alter table site_agent_runs enable row level security;  -- no policies: service-role only, like studio_deployments
```

Also in 0071:

- Storage bucket **`agent-sites`** (private). Layout: `{runId}/original.zip`,
  `{runId}/result.zip`. Contents live in storage, **never** in jsonb (the 2026-08-17
  disk-IO lesson: multi-MB jsonb dragged through TOAST by pollers).
- `notification_rules` seeds for `site_agent_run_ready` (→ role `ticket_assignee`) and
  `site_agent_run_failed` (→ role `ticket_assignee`). Lowercase dept slugs only (the 0066
  `'{Management}'` seed is a known inert-row bug; do not copy it).
- Worker heartbeat: reuse `app_settings` (key `agent_worker_heartbeat`, value
  `{at: iso, host: string}`) — no new table for one row.

House migration rules apply: additive-only, migration lands on prod **before** the code
that reads it, and code tolerates the columns' absence in the interim (0062 lesson).

Statuses: `queued → running → review → deploying → deployed`, with `failed` (from queued/
running — retryable) and `discarded` (terminal, from review). `approved` is not a stored
status — approve flips `review → deploying` directly. A `running` run whose worker died is
reclaimable after a staleness window (no `updated_at` movement for 10 min), same reclaim
philosophy as Site Builder.

## 5. The worker (`scripts/agent-worker/`)

A small standalone Node service in this repo, run on the Windows box under pm2 as
`sed-agent-worker` (documented alongside the existing local `sed-lms` instance). Env comes
from the repo's `.env.local` (Supabase URL + service-role key already present).

Loop, every ~10s:

1. **Heartbeat** — upsert `app_settings.agent_worker_heartbeat` (every ~60s).
2. **Pick** — oldest `queued` run, or a stale `running` run (updated_at older than 10 min).
3. **Claim** — CAS: set `status='running'`, stamp fresh `claim_id`, guard on prior
   `(status, updated_at)`. Every later write carries `.eq('claim_id', …)` so a superseded
   attempt matches zero rows (the `generation_id` discipline, copied).
4. **Workspace** — download `original.zip`, `unzipToMap`, write files to a scratch dir
   `%TEMP%\sed-agent\{runId}\` (fresh per attempt; deleted on completion, best-effort).
5. **Run agy** —
   `agy -p "<task prompt>" --dangerously-skip-permissions --print-timeout <cap>`
   with `cwd` = the workspace. The task prompt contains: the ticket title, description,
   checklist items, any developer `instructions`, and a fixed contract ("edit the static
   site in this directory; do not fetch the network; do not touch files outside it;
   keep index.html present").
   - **Preferred output mode:** `--output-format stream-json` (NDJSON events) — available
     in newer `agy` releases; the box currently has **1.0.0, which lacks the flag**, so the
     worker feature-detects: with stream-json it forwards per-event tails and usage; without
     it, it captures combined stdout/stderr and treats the stream as one growing tail.
     Operator prerequisite: run `agy update` (validated in Phase 0).
   - `--conversation` id is captured (stream-json `init` event or printed session line) and
     stored for the revise loop; revise runs use `--conversation <id>` so follow-ups keep
     the agent's context and cost less quota.
6. **Progress** — throttle to one row-patch per ~2.5s max: `output_tail` (last 2KB),
   `files` (statuses derived from filesystem watching is overkill — updated only at diff
   time in v1), `updated_at`. Narrow updates, guarded by `claim_id`.
7. **Cancellation** — dashboard's discard-while-running sets `status='discarded'`; the
   worker notices on its next progress write (zero rows matched) and kills the `agy`
   process. Also a hard wall-clock cap (default 15 min) kills and marks `failed`.
8. **Harvest** — after exit: walk the workspace, diff against the original map
   (byte-compare; small static sites), classify edit/create/delete, enforce caps
   (≤200 changed files, ≤50MB result — the deploy path's own cap is 60MB), verify
   `index.html` still exists, `zipFromMap` → upload `{runId}/result.zip`, write `files`
   jsonb (paths + actions + sizes only), `summary`, `usage`, flip to `review`, and
   `notify('site_agent_run_ready', …)`.
9. **Failure** — any error: `status='failed'`, `error` = the real message (agy's own words
   for quota/auth problems — the auto-deploy lesson: a run must always say *why*), notify
   `site_agent_run_failed`. Retry is a fresh claim of the same run (dashboard button flips
   it back to `queued`).

Quota/auth realities (accepted, surfaced, not hidden): if the Pro plan's 5-hour window is
exhausted, runs fail with agy's message and retry later; if the cached sign-in expires, runs
fail with an auth error and the runbook is "open Antigravity on the box, sign in again".
The worker box being off = runs sit queued and the dashboard says so (heartbeat staleness).

## 6. Prod routes (all session-authed; `runtime='nodejs'`; no middleware changes)

Gate for all of them: `ALLOWED_PERMS = tickets.resolve | studio.manage` **plus**
`canActOnTicket` for the bound ticket (same object-level scoping the ticket actions use).

| Route | Behaviour |
|---|---|
| `POST /api/tickets/[id]/agent-runs` | Validate: ticket exists + status Assigned/In Progress; caller can act on it; lead has `website_link`; host not protected (`isProtectedDomain`); no active run for the ticket (partial unique index is the backstop). Fetch live zip (`fetchLiveSiteZip` — repack via `unzipToMap`/`zipFromMap` to strip DA's `public_html/` nesting), upload `original.zip`, insert run `queued`, activity-log `site_agent.run.created`. Returns the run. `maxDuration 120` (the fetch can take a while). |
| `GET /api/site-agent/runs/[id]` | Narrow row poll (never `select('*')` — excludes nothing today but keeps the habit; `files`+`output_tail` are small by design). |
| `GET /api/site-agent/runs/[id]/files/[...path]` | `{before, after}` for one file (read both zips from storage, per-process TTL cache) — feeds the diff viewer. |
| `GET /api/site-agent/runs/[id]/preview/[[...path]]` | Serves the **result** file map with `untrustedContentHeaders()` (CSP sandbox, opaque origin), Site Builder's asset-ref rewriting pattern; `?raw=1` source view. |
| `POST /api/site-agent/runs/[id]/approve` | CAS `review → deploying`; `prepareSiteZip(result.zip)` → `snapshotSite` → `overrideLiveSite(host, zip, ticketId)` (internals, not HTTP — same functions the manual upload route calls, so the snapshot, `studio_deployments` stamp, ticket proof row, and website notification all happen exactly as a manual upload) → `deployed` (+ `site_agent.run.deployed`). Failure rolls back to `review` with `error` set, manual retry possible. `maxDuration 300`. |
| `POST /api/site-agent/runs/[id]/revise` | Body `{instructions}`. Only from `review`. Stores instructions, flips to `queued` (keeps `conversation_id` so the worker continues the same agy conversation). |
| `POST /api/site-agent/runs/[id]/discard` | From `review` or `running` (running: worker notices and kills). Deletes `result.zip` best-effort. `site_agent.run.discarded`. |

Activity-log vocabulary: `site_agent.run.created | completed | failed | revised | deployed | discarded`,
`entity_type 'ticket'`, `entity_id = ticket_id` — so agent work appears on the ticket page
next to manual uploads. The deploy itself additionally produces the existing
`studio.site.files_overridden` proof row via `overrideLiveSite`.

## 7. UI (ticket screen)

- **Send to AI** button in `TicketDetail` — shown when the viewer `canActOnTicket` +
  `tickets.resolve`, the lead has a `website_link`, ticket status Assigned/In Progress, and
  no active run. Disabled with a tooltip when the worker heartbeat is stale ("Agent worker
  is offline — it runs on the office machine").
- **Run panel** (inline on the ticket screen, 2s poll while active):
  - `queued`: "Waiting for the agent worker…" (+ offline banner when heartbeat stale).
  - `running`: streaming output tail (monospace, autoscroll), elapsed time, Stop button.
  - `review`: changed-file list (action badges), per-file **diff viewer** (client-side
    line diff of `{before, after}`), **preview iframe** (`sandbox="allow-scripts"`) with a
    page switcher, and the three actions: **Approve & Deploy**, **Request changes**
    (textarea → revise), **Discard**.
  - `deployed`: live link + "restore previous version" pointing at the existing
    snapshots/restore surface; the existing resolve nudge now counts this as site work.
  - `failed`: the error verbatim + Retry.
- Past runs for the ticket listed compactly (status, when, by whom, deployed link).

## 8. Safety

- **Human approval is the only path to the hosting.** The worker has no hosting access at
  all; approve runs on prod and snapshots first; restore is one click and already built.
- **Prompt injection:** ticket text and site files are untrusted input to the agent. The
  task prompt pins the contract; the workspace contains only the site copy (no secrets, no
  repo); harvest ignores anything outside the workspace and enforces path/count/size caps;
  the human diff review is the backstop. `--sandbox` is enabled if Phase 0 shows it works
  headless on Windows (defense in depth, not load-bearing).
- **Blast radius of `--dangerously-skip-permissions`:** accepted by the operator for their
  own machine; scoped by cwd + the caps above. Documented in the runbook, revisited if the
  worker ever moves to shared hardware.
- **Data flow:** client site files go to Google (the agent's model) — same exposure as the
  operator's existing practice of editing these sites in Antigravity locally.
- **ToS:** embedding `agy` in an internal tool is the operator's accepted risk (flagged
  during design); the worker is engine-shaped so the Interactions API (API-key billing) is
  the drop-in successor if this path is ever closed off. agy ≥1.1.13 also accepts
  `GEMINI_API_KEY` as a no-redesign fallback.
- **DB budget:** worker writes are narrow and throttled; dashboard polls only while a run
  is active; nothing new joins the realtime publication.

## 9. Phased build

- **Phase 0 — spike (on this box, before any LMS code):** prove `agy` headless end-to-end:
  `agy update` then `-p` with `--output-format stream-json` in a scratch site dir; confirm
  Pro-account auth works headless (no API-key demand), edits land in cwd, `--conversation`
  resume works, and what usage data the result event carries. Outcome: worker invocation
  contract pinned as fixtures for tests. If stream-json is unavailable even after update,
  the text-mode fallback contract is pinned instead.
- **Phase 1 — pipeline:** migration 0071; `lib/site-agent/` (types, task-prompt builder,
  harvest/diff, storage IO); worker service + pm2 setup; create + poll routes; run panel
  with live tail. Milestone: a ticket's run goes queued→running→review with visible progress.
- **Phase 2 — review & deploy:** files/preview/diff routes + review UI; approve/discard;
  notifications; activity log + ticket proof integration. Milestone: end-to-end on a
  staging-subdomain site.
- **Phase 3 — polish:** revise loop, worker heartbeat UI states, stale-run reclaim, run
  history on the ticket, docs/changelog.

## 10. Testing

House style: pure logic unit-tested; effectful modules tested with injected fakes
(`DeployRunDeps` pattern); routes tested by importing handlers.

- Worker: agy driver behind an interface (`AgentCliDriver`); tests feed recorded
  stream-json fixtures from Phase 0 (and a text-mode fixture); claim/CAS, throttling,
  cancellation, harvest caps, failure paths all covered with a fake DB (extend the
  `fakeStudioAdmin` helper).
- Harvest/diff: pure function on (original map, workspace map) — exhaustive cases
  (edit/create/delete, index.html removal refusal, cap enforcement, path escapes).
- Routes: permission matrix (tickets.resolve vs studio.manage vs neither; canActOnTicket),
  state-machine transitions, protected-domain refusal, one-active-run conflict.
- Preview route: CSP headers, path traversal, raw view (copy Site Builder's test shape).
- One env-gated live test hitting real `agy` (skipped unless `AGY_LIVE_TEST=1`), like the
  gated live-deploy verification tests.

## 11. Operator runbook (will also land in docs)

- One-time: on the Windows box, `agy update`, sign into Antigravity with
  socialexpertdigitalllc@gmail.com, `pm2 start ... --name sed-agent-worker`, `pm2 save`.
- Prod: apply migration 0071 **before** deploying the code (house rule).
- If runs queue forever → check heartbeat/pm2 on the box (`pm2 list`, known failure mode:
  empty pm2 + missing dump).
- If runs fail with auth errors → re-sign-in to Antigravity on the box.
- If runs fail with quota errors → Pro plan window exhausted; retry later or buy AI
  credits; long-term fallback: switch the worker to `GEMINI_API_KEY` billing.

## 12. Explicitly out of scope (v1)

- Auto-deploy without review (the whole point is the review gate).
- Sites not reachable via `leads.website_link` (unlinked/untracked deployments).
- Editing anything other than static site files (no DB-backed sites, no LMS code).
- Multi-ticket batching; scheduling; a second engine (interface left ready).
