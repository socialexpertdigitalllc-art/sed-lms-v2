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
| Runs sit "Waiting for the agent worker", panel says worker offline | Box off, pm2 dead (`pm2 list` — known failure: empty list + missing dump → recreate + `pm2 save`), or `AGENT_WORKER_ENABLED` missing |
| Runs fail with auth/sign-in errors | agy's cached sign-in expired — sign in again on the box (interactive `agy`) |
| Runs fail with quota/rate errors | The Pro plan's 5-hour Antigravity window is exhausted — retry later, buy AI credits, or (last resort) switch the worker to API-key billing (`GEMINI_API_KEY` for agy) |
| A run stuck "Deploying" >10 min | The approve request died mid-deploy — the panel's Stop button becomes available after 10 minutes; discard and re-approve |
| Disk fills on the box | Scratch workspaces live under `%TEMP%\sed-agent\` — safe to delete anything there while no run is active |

## Kill switch

Remove `AGENT_WORKER_ENABLED=1` from the box's `.env.local` and
`pm2 restart sed-lms` — queued runs wait harmlessly; developers can still
discard them from the ticket.

Source of truth for this SOP: `instrumentation.ts`, `app/api/site-agent/process/route.ts`,
`lib/site-agent/{worker,workspaceFs,agy}.ts`, `components/tickets/AgentRunPanel.tsx`.
