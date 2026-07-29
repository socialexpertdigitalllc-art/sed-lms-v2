# AI provider rate limiting and retry — design

**Date:** 2026-07-28
**Status:** approved for planning
**Scope:** subsystem **A** of a four-part effort. See "Sequencing" at the end.

## Problem

Site Builder generations began returning HTTP 429 after roughly the fifth to
ninth run. Three separate defects combine to produce this:

1. **Nothing limits concurrency.** `runSite` (`lib/site-builder/run.ts`) fires
   every page with `Promise.all`, so a six-page site opens seven or more
   simultaneous provider calls. Site Studio's `runWrite` does the same one
   level down, splitting a single large page into parallel batch calls.
2. **HTTP status is discarded.** `callWithProvider` (`lib/ai-tools/run.ts`)
   collapses every non-OK response into `throw new Error(msg)`. Nothing
   downstream can distinguish a 429 from a 400, so nothing can react to one.
3. **There is no retry.** A rate-limited call fails permanently on first
   contact. There is no backoff, and `Retry-After` is never read.

The result is that transient, entirely recoverable throttling presents as a
hard page failure — and, when every page is throttled at once, as a dead run.

## What the vendors actually limit

Verified against vendor documentation on 2026-07-28. This table is the reason
the design is shaped the way it is.

| Provider | Dimensions limited | `x-ratelimit-*` headers documented |
| --- | --- | --- |
| MiniMax | RPM, TPM. Concurrency published only for Music Generation (CONN 20). | No |
| Kimi (Moonshot) | Concurrency, RPM, TPM, TPD — full published tier table. | No |
| DeepSeek | Concurrency only (v4-pro 500, v4-flash 2500). No RPM/TPM documented. | No |
| Gemini | RPM, TPM, RPD, plus a 10-minute spend cap. | Yes — `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`, sometimes `retry-after` |

Sources: [MiniMax](https://platform.minimax.io/docs/guides/rate-limits),
[Kimi](https://platform.kimi.ai/docs/pricing/limits),
[DeepSeek](https://api-docs.deepseek.com/quick_start/rate_limit),
[Gemini](https://ai.google.dev/gemini-api/docs/rate-limits).

Two conclusions follow directly, and both were surprises worth the check:

**Rate-limit headers cannot be load-bearing.** Only Gemini documents them. A
design that resolved limits primarily from response headers would be dead code
on three of four providers. Headers are therefore read *opportunistically* to
refine a budget we already hold, never as the source of it.

**Every dimension must be independently optional.** DeepSeek documents no RPM
at all; MiniMax documents no chat concurrency. A budget type that requires all
three would force us to invent ceilings the vendor never stated, which is how
you get a limiter that throttles for no reason. Absent means unlimited.

A note on the operator's MiniMax plan, which advertises "run 3–4 concurrent
agents": that is a plan-marketing figure, not the documented API limit. MiniMax's
API docs limit chat on RPM and TPM. The observed failure pattern — several runs
succeeding before failures begin — fits a per-minute ceiling better than a hard
concurrency wall, which would have failed the very first multi-page run.

## Architecture

Three new modules and one modified file. Every existing caller keeps its
current signature: this is additive at a shared seam, so Site Builder, Site
Studio, the template engine and image ranking all gain protection with no edits
of their own.

### 1. `lib/ai-tools/providers/limits.ts` — the budget model

```ts
export interface RateBudget {
  concurrency?: number;  // absent = vendor documents no concurrency ceiling
  rpm?: number;
  tpm?: number;
  tpd?: number;
}
```

Every field optional, by the reasoning above. Ships with per-provider defaults
taken from the table above, deliberately conservative where a vendor publishes
nothing. Resolution order for the budget actually used:

1. Operator's stored per-provider override (see "Settings surface").
2. The shipped default for that provider.

The adaptive layer (below) may only scale this budget *down*, never above what
resolution produced. An operator who upgrades their tier raises the ceiling by
editing settings; the limiter never optimistically exceeds a stated limit.

### 2. `lib/ai-tools/providers/gate.ts` — the in-process gate

One bucket per **provider key** — not per task and not per model. MiniMax
pools text, image, speech and music against a single quota, so `image_rank`
vision calls and `site_build` page calls must draw from the same budget. A
per-task limiter would let two subsystems collide while each believed it was
within its allowance.

In-memory is correct here: production runs as a single long-lived Node process
(`next start` plus the `setInterval` pollers in `instrumentation.ts`). A
Postgres-coordinated limiter would add latency and failure modes for a
multi-instance deployment that does not exist. The gate is written behind a
narrow interface so a DB-backed implementation could replace it if that ever
changes.

Acquisition, per call:

- a **concurrency** slot, if that provider declares one;
- an **RPM** token from a sliding one-minute window, if declared;
- a **TPM** reservation, if declared (see estimation below);
- a **TPD** decrement, if declared. TPD is in-memory like the rest and so
  resets on restart — an accepted limitation, documented rather than hidden,
  because only Kimi's lowest tier declares one and none of the operator's
  current tiers do.

Dimensions the provider does not declare are skipped entirely, not defaulted.

**Token estimation.** A pre-call reservation needs an output estimate, and
naively reserving `maxTokens` would be catastrophic: `"model-max"` on MiniMax
M3 requests 131,072 tokens, which against a 1M TPM would permit roughly seven
calls per minute. Instead:

- input estimate = `ceil((system.length + user.length) / 4)`, plus a flat
  per-image allowance for multimodal calls;
- output estimate starts at `min(maxTokens, inputEstimate × 1.2)` — a page
  rewrite returns roughly what it was given — and is then replaced by a rolling
  p90 of *observed* output tokens for that provider+model once samples exist;
- after the call, the reservation is reconciled against the real
  `usage.total_tokens` from the response, and the sample feeds the rolling
  estimate.

This makes the TPM accounting self-calibrating from live traffic rather than
from a guessed constant.

**Adaptive scaling (AIMD).** Each provider carries an `effectiveScale` in
`(0, 1]`, multiplied into its resolved budget:

- on a 429: `scale = max(minScale, scale × 0.5)`;
- after 20 consecutive successes, or 60 seconds with no 429, whichever comes
  first: `scale = min(1, scale + 0.1)`.

`minScale` floors the budget at one concurrent request and one request per
minute, so the gate can never collapse to zero and wedge a run permanently.

### 3. `lib/ai-tools/providers/errors.ts` — typed provider failures

```ts
export class ProviderHttpError extends Error {
  status: number;
  retryAfterMs: number | null;   // parsed from Retry-After: seconds OR HTTP-date
  rateLimit: { limit?: number; remaining?: number; resetMs?: number } | null;
}
```

Plus a classifier:

- **retryable** — 429, 500, 502, 503, 504, network errors, and the existing
  call timeout;
- **terminal** — 400, 401, 403, 404, 413, 422. Retrying these cannot succeed
  and burns quota that a concurrent run needs;
- **abort** — `AiCallAborted` keeps its current meaning and is never retried.

### 4. `lib/ai-tools/run.ts` — `callWithProvider`

Changes, in order:

1. Acquire from the gate before dialing; release in a `finally`.
2. On a non-OK response, throw `ProviderHttpError` carrying status, parsed
   `Retry-After` and any `x-ratelimit-*` seen — instead of flattening to
   `Error(msg)`. The human-readable message is preserved verbatim so existing
   error surfaces do not regress.
3. Retry retryable failures, up to **4 attempts total** (3 retries): honor
   `Retry-After` when present, clamped to **60s** so a pathological header
   cannot wedge a run; otherwise exponential backoff from **1s**, doubling,
   with full jitter, capped at **30s**.
4. Feed every outcome back into the gate's adaptive scale.

## Failure semantics

**A 429 must not trigger provider fallback.** `callForTask`
(`lib/ai-tools/providers/run.ts`) currently retries a failed call on the task's
*default* provider. That is correct for a configuration failure — the assigned
provider is disabled, unconfigured, or rejecting the key — and wrong for a rate
limit: it would silently move a page rewrite from the operator's chosen MiniMax
model onto Gemini because MiniMax was momentarily busy, changing which model
wrote the customer's site with no signal that it happened. This codebase already
treats silent model substitution as a defect elsewhere.

So: fallback fires on terminal configuration and auth errors only. A 429 that
survives its retry budget fails the call, and the page fails with it.

That is deliberately not the end of the story — making a failed page and a
failed run recoverable is subsystem **B**, which follows immediately. Within
A's scope, the honest outcome of exhausted retries is a clear, attributable
failure rather than a quietly wrong site.

## Request duration

Serialising calls behind a gate makes generations slower — that is the point,
and it is correct. But `app/api/site-builder/runs/[id]/generate/route.ts`
declares `maxDuration = 300`, and a seven-call run at a low concurrency ceiling
with backoff waits will exceed five minutes.

Per the operator's decision, this is handled by raising the ceiling rather than
restructuring generation into resumable chunks. Self-hosted `next start` does
not enforce `maxDuration` the way a serverless platform does, and the run screen
already polls live per-page progress, so a long run remains observable
throughout. Making generation resumable is deferred to subsystem B, where it
belongs.

## Settings surface

`/admin/ai-models` gains a per-provider rate-limit block: concurrency, RPM,
TPM, TPD. Each field blank means "not limited on this dimension", with the
shipped default shown as placeholder text. Read-only gate state is displayed
alongside — current in-flight count, effective scale, and 429s in the last hour
— because an adaptive limiter the operator cannot observe is a black box when
it misbehaves.

Storage: a nullable `rate_limits jsonb` column on `ai_providers`.

**One trap to avoid.** `readProviderRows` in
`lib/ai-tools/providers/config.ts` selects an explicit column list and swallows
errors into `return []`. Adding `rate_limits` to that list would, on any
environment where the migration has not yet run, error the query, hit the catch,
and silently report *every provider as unconfigured* — taking all AI routing
down. `readAssignmentRows` already documents this exact hazard and uses `*` for
it. `readProviderRows` must be switched to `*` in the same change, for the same
reason.

## Observability

No new tables. A `console.warn` on each 429 naming the provider, the parsed
`Retry-After`, and the resulting scale change; the same information surfaced
read-only in the settings block above.

## Testing

Vitest, hermetic — stubbed `fetch`, fake timers, no network anywhere.

- `limits.ts`: an absent dimension imposes no ceiling; operator override
  replaces the default; adaptive scale can lower but never raise past the
  resolved budget.
- `gate.ts`: concurrency cap holds under parallel acquisition; RPM window
  slides correctly; TPM reservation is taken pre-call and reconciled against
  actual usage post-call; an undeclared dimension is not enforced; `minScale`
  floor is respected.
- `errors.ts`: `Retry-After` parsed in both seconds and HTTP-date form;
  classification table covers each documented status.
- `run.ts`: a 429 followed by success retries and succeeds; a 400 fails
  immediately without retry; an abort is never retried; a 429 does **not**
  trigger provider fallback; a terminal auth error does.

## Out of scope

Explicitly not in this subsystem, to keep it reviewable:

- **B** — retrying a failed run with its original settings and images;
  regenerating an individual failed page; never orphaning partial work.
  (`generate/route.ts` accepts only `status === "queued"`, so a failed run is
  currently unrecoverable; the regenerate route refuses anything that is not
  `review`/`approved`.)
- **C** — a durable multi-lead generation queue with a processor that paces
  itself against this subsystem's budgets.
- **D** — dynamic model discovery and live token limits, plus the broader
  static-to-dynamic audit.

**One finding from D that is worth pulling forward on its own.**
`lib/ai-tools/providers/registry.ts` hardcodes DeepSeek as `deepseek-chat` and
`deepseek-reasoner` at 8,192 max output tokens. Neither model id appears in
DeepSeek's current documentation; the live models are `deepseek-v4-pro` and
`deepseek-v4-flash` at **1M context and 384K max output** — roughly 47× the
recorded ceiling. Because `site_build` and `content_write` require
`minOutputTokens: LONG_OUTPUT_TOKENS` (32,000), the stale entry makes DeepSeek
ineligible for the two tasks it is most capable of serving. This is a
data-only correction to one descriptor and does not depend on any of D's
machinery; it can land independently at any time.

## Sequencing

A (this document) → B (run recovery) → C (multi-lead queue) → D (dynamic
registry and static audit). Each gets its own spec, plan, and implementation
cycle.
