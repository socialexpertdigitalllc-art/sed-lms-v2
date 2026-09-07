# Ticket Agent worker — operator runbook

The Ticket Agent ("Send to AI" on tickets) runs Antigravity's `agy` CLI on the
office Windows box — the ONLY machine with the Antigravity sign-in. Prod never
runs the agent; it only creates runs and deploys approved results.

## One-time setup (Windows box)

0. Prod database: migration `0071_site_agent_runs.sql` must be applied before
   the code deploys (it was applied to the shared DB on 2026-09-01 — this
   line is for rebuilding environments).
1. `agy update` — the worker needs ≥1.1.22 (`--output-format stream-json`).
2. Sign in with the Pro-plan Google account (socialexpertdigitalllc@gmail.com):
   run `agy` interactively once; if it lands in a GCP/project mode ("quota
   project", "invalid location" errors), log out inside agy and sign in with
   the Google account instead — runs must draw from the AI Pro plan's
   Antigravity quota, not a GCP project.
3. In this repo's `.env.local` on the box: add `AGENT_WORKER_ENABLED=1`
   (keep `WGE_POLLERS_DISABLED=1` — prod runs the recovery sweeps; this box
   runs ONLY the agent poller).
4. Rebuild/restart the local instance: `pm2 restart sed-lms` (the poller
   lives in the app's instrumentation and kicks /api/site-agent/process
   every 20s).
5. Verify: open any eligible ticket in the dashboard — the Send to AI area
   should NOT say the worker is offline after ~a minute.

## Failure playbook

| Symptom | Cause / fix |
|---|---|
| Runs sit "Waiting for the agent worker", panel says worker offline | Box off, pm2 dead or app stopped (`pm2 list`; fix: `pm2 start sed-lms` then **`pm2 save`**), or `AGENT_WORKER_ENABLED` missing. NOTE: pm2 "online" with `pid N/A` is a ZOMBIE — the process is dead; restart anyway (the port-3000 watchdog below now auto-fixes this within ~3 min) |
| Worker offline after every reboot | Stale pm2 dump: `pm2 resurrect` restores whatever state was last SAVED, and a dump saved while sed-lms was stopped resurrects it stopped (this stranded the worker for 11h on 2026-09-02). Fix: `pm2 start sed-lms && pm2 save`. Guard: the `SED-LMS-agent-worker-ensure` HKCU Run entry (script `C:\Users\pc\.pm2\ensure-sed-worker.cmd`) force-starts sed-lms ~30s after logon and re-saves the dump |
| Runs fail with auth/sign-in errors | agy's cached sign-in expired — sign in again on the box (interactive `agy`) |
| Runs fail with quota/rate errors | The Pro plan's 5-hour Antigravity window is exhausted — retry later, buy AI credits, or (last resort) switch the worker to API-key billing (`GEMINI_API_KEY` for agy) |
| A run stuck "Deploying" >10 min | The approve request died mid-deploy — the panel's Stop button becomes available after 10 minutes; discard and re-approve |
| Disk fills on the box | Scratch workspaces live under `%TEMP%\sed-agent\` — safe to delete anything there while no run is active |

## Port-3000 watchdog (added 2026-09-07)

pm2 can show sed-lms "online" with `pid N/A` while the node process is dead
(zombie entry — this caused a 3.5h outage on 2026-09-07 that the logon
ensure-script couldn't catch). Guard: Scheduled Task
`SED-LMS-agent-worker-watchdog` runs
`C:\Users\pc\.pm2\watchdog-sed-worker.ps1` every 3 minutes (as `pc`, only
while logged in; tracked copy: `scripts/watchdog-sed-worker.ps1` — edit
there, then copy to `.pm2`). If nothing is listening on port 3000 it runs
`pm2 restart sed-lms` (falling back to `pm2 resurrect` + restart), waits for
the port, then `pm2 save`. Log: `C:\Users\pc\.pm2\watchdog-sed-worker.log`
(healthy probes are silent). Live-tested 2026-09-07 with a staged
`pm2 stop`: detected and fully recovered (restart + save) in ~2.5 min,
under the 5-min heartbeat threshold.

Do NOT `tail -f` the watchdog log: Unix-style tail on Windows locks the
file against writers and the watchdog's log writes fail — read it with
`Get-Content` or an editor. If a lock does happen, lines spill to
`watchdog-sed-worker.log.2` instead of being lost.

Safety valves:
- **Pause during maintenance** (stop → build → start): create the file
  `C:\Users\pc\.pm2\watchdog-disabled`; delete it when done. Otherwise the
  watchdog will restart sed-lms out from under you mid-build.
- It refuses to restart while `.next\BUILD_ID` is missing (wiped/in-progress
  build would crash-loop) — it logs instead.
- 10-minute cooldown between restart attempts (state file
  `watchdog-sed-worker.state`), so a slow cold start isn't double-restarted.

## Reboots and pm2 save discipline

The box auto-recovers from a reboot in two logon steps (both HKCU Run
entries): `PM2` (pm2-windows-startup) runs `pm2 resurrect`, then
`SED-LMS-agent-worker-ensure` runs `C:\Users\pc\.pm2\ensure-sed-worker.cmd`
30s later, which `pm2 start sed-lms` + `pm2 save` regardless of what the
dump said. Expect the worker online ~1 minute after logon — the box must be
LOGGED IN, not just powered on (Run entries fire at logon).

Whenever you deliberately change pm2 state (stop for a rebuild, new app),
finish with `pm2 save` while things are in the state you want restored.
Never save while sed-lms is stopped.

## Kill switch

Remove `AGENT_WORKER_ENABLED=1` from the box's `.env.local` and
`pm2 restart sed-lms` — queued runs wait harmlessly; developers can still
discard them from the ticket.

## Model list

The worker refreshes `agy models` at most every 10 minutes (on boot, then
inside its poll cycle) and publishes the parsed list for the pre-send
dialog. An empty model selector means the worker hasn't published a list
yet — check the heartbeat before assuming agy is broken. Either way the run
still works: with no model chosen it uses Antigravity's default.

## Ticketless edits

The lead screen's "AI edit site" button runs the same edit → review →
deploy pipeline as a ticket's Send to AI, with no ticket bookkeeping — no
status transitions, no item completion, no ticket proof card. Only one
active ticketless run is allowed per lead at a time.

## Automation

Send-to-AI auto-starts an `Assigned` ticket to `In Progress`. A deploy
marks the run's change items done. A ticket whose items are all done —
whether the AI's deploy did it or a developer ticked the last box by
hand — auto-resolves. If you don't want a ticket auto-resolving, leave at
least one item unticked.

Source of truth for this SOP: `instrumentation.ts`, `app/api/site-agent/process/route.ts`,
`lib/site-agent/{worker,workspaceFs,agy}.ts`, `components/tickets/AgentRunPanel.tsx`.
