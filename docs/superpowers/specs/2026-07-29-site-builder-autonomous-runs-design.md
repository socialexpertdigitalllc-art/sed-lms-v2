# Site Builder autonomous runs — design

**Date:** 2026-07-29
**Status:** approved (operator: "yes, do it")
**Scope:** phase 1 of subsystem C. Phase 2 (live output streaming) and phase 3
(multi-lead bulk queue) follow as their own specs.

## Problem

Rate limiting made individual calls survivable, but nobody made the RUN
responsible for using that to finish its job. A page that exhausts its 4 HTTP
attempts is handed back to the operator; a run only starts when someone opens
its screen; and when a provider quota window (MiniMax's 5-hour / weekly Token
Plan windows) is exhausted, every retry burns against a wall that will not move
until a reset time the system never looks at. The operator's words: "if the
user needs to keep an eye on each run and stop and retry manually, what's the
point of the rate limiting?"

## Design

### 1. Retry rounds inside the run

The generation core loops instead of making one pass:

- After each `runSite` pass, failed pages are CLASSIFIED. `callOrFail` in
  `generate.ts` already catches the thrown provider error; it now also records
  `retryable` (via `isRetryableError`) and any `retryAfterMs` on the failure
  outcome, and `PageState` carries `retryable?: boolean` through to the row.
- Pages with `retryable !== false` are re-run in the next round via the
  existing `resume` machinery — finished pages cost nothing.
- Waits between rounds escalate (30s, 2m, 5m, 10m cap), always respecting the
  largest vendor `Retry-After` seen in the round.
- The loop ends when: every page is `ok` (→ review); every remaining failure
  is terminal (→ failed, with the real reason — retrying cannot fix a bad
  key); or the in-request ceiling (~45 min, safely under `maxDuration` 3600)
  is reached (→ park, below).

### 2. Quota-aware pacing (the operator's explicit ask)

New module `lib/ai-tools/providers/quota.ts`: `probeQuota(providerKey,
credentials)` → `{ windows: [{label, remainingTokens?, resetAt?}] } | null`.
Only MiniMax is implemented (`GET https://api.minimax.io/v1/token_plan/remains`,
Bearer key); every other provider returns null ("unknown"), and ANY probe
failure returns null — quota awareness is an enhancement and must never fail a
run. The response is parsed tolerantly: unknown shape → null.

Before a retry round whose failures were throttles, the loop probes. If a
window is exhausted and its reset is:
- within the in-request ceiling → wait for the reset, then continue;
- beyond it → PARK the run.

### 3. Parking and automatic resume

Parking reuses `status: "failed"` (no status-constraint migration; every gate
already treats `failed` as retryable) plus a new nullable column
`builder_runs.resume_at` (migration 0064) and an error message that says what
is actually happening: "Paused — MiniMax's 5-hour quota is exhausted; resumes
automatically at HH:MM."

`options.auto_resume` (default **true**) controls what happens at `resume_at`:

- **auto** — the background processor re-fires generation; the operator was
  never involved.
- **manual** — the run stays parked; the run screen shows the countdown and
  the existing Retry button.

The toggle is per-run, shown on the run screen, changeable while parked.

### 4. A server-side processor (runs start without a screen)

Today a `queued` run only starts when its screen mounts. A new
secret-guarded route `POST /api/site-builder/process` (same `x-wge-secret`
pattern and `instrumentation.ts` poller as the WGE queue, ~60s interval):

- kicks any `queued` run;
- kicks any `failed` run whose `resume_at` has passed and whose
  `options.auto_resume` is not false.

To share the generation core between the operator route and the processor, the
`/generate` handler's body is extracted to `lib/site-builder/generateRun.ts`;
both routes become thin wrappers. The claim token (`generation_id`) already
makes double-kicks safe.

### 5. UI

- The in-flight panel shows round state: "Round 2 — 2 pages remaining, next
  attempt in 90s" (persisted each round, rides the existing polling).
- A parked run shows "Paused until HH:MM" with the auto/manual toggle.
- `resume_at` and the paused explanation replace the generic failure copy when
  present.

## Error handling

- The quota probe can never fail or delay a run by more than its own short
  timeout (5s); null means "probe unknown, fall back to escalating waits".
- Terminal classification is conservative: only failures `isRetryableError`
  rejects are terminal. Unknown → retryable (waiting costs less than a false
  dead-end).
- The processor holds one run's generation at a time (single-flight, like the
  WGE processor) so bulk kicking cannot burst past the gate.

## Testing

- Classification: a 429-thrown page is `retryable: true`; a 401 page is
  `retryable: false`; round loop retries only retryables and stops when all
  remaining are terminal.
- Quota: parses a known-shape response; null on garbage, non-200, timeout;
  loop waits to `resetAt` when within ceiling, parks with `resume_at` beyond.
- Parking: `resume_at` + auto → processor kicks; manual → it does not.
- Processor: kicks queued runs; respects the secret; single-flight.
- UI: round status renders; parked run shows countdown and toggle; toggle
  PATCH persists.
- **Acceptance is live**: a real lead generating end-to-end on production
  routing, including one run deliberately driven into a quota wall.

## Out of scope

- Live output streaming (phase 2 — next spec).
- Multi-lead bulk queue UI (phase 3; the processor built here is its engine).
- Cancelling a superseded attempt's in-flight AI calls (known follow-up).
