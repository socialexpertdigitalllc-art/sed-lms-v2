/**
 * The provider rate gate: the one place a provider's concurrency, RPM, TPM and
 * TPD budgets are enforced, plus the token estimation that TPM accounting needs
 * to reserve against.
 *
 * Two halves, in order:
 *
 *  1. TOKEN ESTIMATION (below) — pure functions and a small learning estimator.
 *     Reserving TPM before a call requires guessing its output size; these
 *     learn that guess from real `usage` figures instead of trusting a constant.
 *  2. `ProviderGate` (further down) — the stateful limiter itself, one instance
 *     per provider, including the AIMD layer that backs a provider off after a
 *     429 and walks it back up once the congestion clears.
 *
 * Everything here is in-memory and single-process by design; see the
 * `ProviderGate` docblock for why that is the right call and what it costs.
 */

/* ------------------------------------------------------- token estimation */

/**
 * A per-minute TOKEN budget has to be reserved BEFORE the call, because the
 * whole point is to not make a call there is no room for. That needs an output
 * estimate, and the obvious candidate — the requested `maxTokens` — is
 * catastrophic: `"model-max"` on MiniMax M3 asks for 131,072 tokens, so
 * reserving it against a 1,000,000 TPM would permit roughly seven calls a
 * minute regardless of how small the replies actually are.
 *
 * Instead the reservation is `input + input x ratio`, where the ratio is
 * LEARNED from real `usage` figures per provider+model. A page rewrite returns
 * roughly what it was given, so the seed is 1.2; once samples exist the p90 of
 * observed ratios replaces it. This makes TPM accounting self-calibrating from
 * live traffic rather than from a constant somebody guessed.
 */

import { AiCallAborted } from "@/lib/ai-tools/abort";
import { callTimedOutMessage, isRateLimitError, ProviderHttpError } from "./errors";
import { MIN_SCALE, scaleBudget, type RateBudget } from "./limits";

/** Rough tokens-per-character. Matches the existing fallback in run.ts.
 *  This UNDER-counts for dense markup/JSON and for non-Latin scripts, so the
 *  input side of a reservation errs LOW — the unsafe direction. Tolerable
 *  because the gate rewrites the ledger entry with the vendor's real
 *  `total_tokens` on settle, and a resulting 429 backs the budget off; a
 *  tokenizer dependency on the hot path is not worth the accuracy. */
export const CHARS_PER_TOKEN = 4;

/** Flat per-image allowance. Vendors tile images differently and none of the
 *  four publish a formula for the OpenAI-compatible surface, so this is a
 *  deliberately generous single number rather than false precision. */
export const IMAGE_TOKEN_ESTIMATE = 1600;

/** Output-to-input ratio assumed until real samples exist. A rewrite returns
 *  approximately its input, plus headroom. */
export const SEED_OUTPUT_RATIO = 1.2;

/** Samples retained per provider+model. Small enough that a workload change
 *  re-calibrates within a run, large enough for a p90 to mean something. */
export const OUTPUT_SAMPLE_SIZE = 20;

/** Samples required before the observed p90 is trusted over the seed. */
export const MIN_OUTPUT_SAMPLES = 3;

export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export function estimateInputTokens(systemPrompt: string, userPrompt: string, imageCount = 0): number {
  const chars = systemPrompt.length + userPrompt.length;
  return Math.ceil(chars / CHARS_PER_TOKEN) + imageCount * IMAGE_TOKEN_ESTIMATE;
}

/**
 * Observed output-to-input ratio for one call, or null when the vendor's
 * `usage` block is absent or unusable. Handles the common case of a provider
 * reporting `total_tokens` without `completion_tokens`.
 */
export function outputRatioFrom(usage: TokenUsage | null | undefined): number | null {
  if (!usage) return null;
  const prompt = usage.prompt_tokens;
  if (typeof prompt !== "number" || !Number.isFinite(prompt) || prompt <= 0) return null;
  const completion =
    typeof usage.completion_tokens === "number"
      ? usage.completion_tokens
      : typeof usage.total_tokens === "number"
        ? usage.total_tokens - prompt
        : undefined;
  if (typeof completion !== "number" || completion < 0 || !Number.isFinite(completion)) return null;
  return completion / prompt;
}

/** Rolling p90 of observed output ratios, keyed by `${providerKey}:${model}`.
 *  The upper tail is chosen deliberately, not the median: over-reserving on a
 *  low-ratio call only costs some throughput, whereas under-reserving triggers
 *  a 429 and a multiplicative backoff of the ENTIRE provider budget — so the
 *  asymmetry in outcomes justifies an asymmetric (high-percentile) estimate. */
export class OutputRatioEstimator {
  private readonly samples = new Map<string, number[]>();

  record(key: string, ratio: number): void {
    if (!Number.isFinite(ratio) || ratio < 0) return;
    const arr = this.samples.get(key) ?? [];
    arr.push(ratio);
    while (arr.length > OUTPUT_SAMPLE_SIZE) arr.shift();
    this.samples.set(key, arr);
  }

  ratio(key: string): number {
    const arr = this.samples.get(key);
    if (!arr || arr.length < MIN_OUTPUT_SAMPLES) return SEED_OUTPUT_RATIO;
    const sorted = [...arr].sort((a, b) => a - b);
    // Nearest-rank p90. Note that below ~10 samples this IS the maximum — that is
    // inherent to the definition, not a bug, and it errs toward over-reserving,
    // which costs throughput rather than a 429.
    const index = Math.max(0, Math.ceil(sorted.length * 0.9) - 1);
    return sorted[index];
  }
}

/* --------------------------------------------------------------- the gate */

export const WINDOW_MS = 60_000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** How often a caller blocked purely on CONCURRENCY re-checks. Concurrency has
 *  no time-based answer to "when will a slot free" — it frees when some other
 *  call returns — so this dimension polls while the rate dimensions compute an
 *  exact wait. 50ms is imperceptible next to a multi-second model call. */
export const GATE_POLL_MS = 50;

/** Ceiling on a single wait slice. NOT for abort responsiveness — `sleep` is
 *  abort-aware, so even a 600s sleep rejects the instant the signal fires. The
 *  reason is STALENESS: a computed wait is only valid for the state that
 *  produced it, and that state can improve underneath a parked caller — another
 *  call settling under its reservation frees TPM early, `setBudget` can widen
 *  the budget outright, and a quiet-period ramp raises the scale. Re-checking
 *  each second catches all three; sleeping the full computed interval would
 *  wait out a limit that had already lifted. */
export const MAX_WAIT_SLICE_MS = 1000;

/** How long a caller may be parked before the gate says so — once per acquire,
 *  not once per poll. Below this, waiting is normal pacing and not worth a line
 *  in the log; above it, a generation looks hung and the operator needs to know
 *  which provider and which dimension is responsible. */
export const GATE_SLOW_WAIT_WARN_MS = 10_000;

export interface GateSlot {
  /** The call succeeded: reconcile the token reservation against what was
   *  really spent, feed the ratio estimator, and count toward ramp-up. */
  settle(usage: TokenUsage | null): void;
  /** The call failed: release the slot, and if it was throttled, halve the
   *  provider's effective budget.
   *
   *  `sameCongestionEvent` is the caller ASSERTING that this 429 is a repeat of
   *  a wall already counted — a retry of a call that just throttled. It is
   *  still recorded as a health signal, but it does not back the budget off a
   *  second time. Only a caller that retries can know this; see
   *  `recordThrottle` for why the wall-clock cooldown cannot infer it. */
  settleError(error: unknown, opts?: { sameCongestionEvent?: boolean }): void;
}

export interface GateSnapshot {
  key: string;
  inFlight: number;
  requestsThisMinute: number;
  tokensThisMinute: number;
  /** Tokens charged against the current 24h window. */
  dayTokens: number;
  /** Current adaptive multiplier applied to the resolved budget. */
  scale: number;
  /** 429s seen in the last hour — the operator-facing health signal. */
  throttlesLastHour: number;
  lastThrottleAt: number | null;
}

/** Which budget dimension is holding a caller back. */
export type GateDimension = "concurrency" | "rpm" | "tpm" | "tpd";

/**
 * A caller waited longer for budget than it was willing to.
 *
 * Deliberately worded through `callTimedOutMessage` so the existing
 * `isRetryableError` in errors.ts classifies it as retryable via
 * `CALL_TIMEOUT_MARKER` — no change to errors.ts required. Retryable is the
 * right classification: a gate timeout means the budget was busy, which is a
 * transient condition and precisely what a backoff-and-retry loop is for.
 */
export class GateTimeoutError extends Error {
  constructor(
    readonly providerKey: string,
    readonly dimension: GateDimension | null,
    readonly waitedMs: number,
  ) {
    super(callTimedOutMessage(`${providerKey} rate gate (blocked on ${dimension ?? "budget"})`, waitedMs));
    this.name = "GateTimeoutError";
  }
}

/** Sleep that an abort can cut short, so a Stop is honoured while a caller is
 *  parked waiting for budget rather than only while it is on the wire. */
export function sleep(ms: number, signal?: AbortSignal, label = "rate gate"): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AiCallAborted(label, signal.reason));
      return;
    }
    // Declared before `cleanup` closes over it. Assigning it below would work
    // only because `addEventListener` is registered after `setTimeout` runs;
    // swapping those two lines would turn a synchronous abort into a
    // ReferenceError on the TDZ. Hoisting the binding removes that trap.
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new AiCallAborted(label, signal?.reason));
    };
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Multiplier applied to the budget on each congestion event. */
export const THROTTLE_BACKOFF_FACTOR = 0.5;
/** Additive step when recovering. */
export const RAMP_STEP = 0.1;
/** Consecutive successes that earn a ramp step. */
export const RAMP_SUCCESS_STREAK = 20;
/** Quiet period (no 429) that earns a ramp step on its own. */
export const RAMP_QUIET_MS = 60_000;

/**
 * How close together two 429s must be to count as ONE congestion event.
 *
 * 429s do not arrive alone. Every call already in flight hits the same wall at
 * the same moment, so a six-page site produces six of them within milliseconds
 * — one fact about the provider, reported six times. Halving per REPORT rather
 * than per FACT compounds: four rapid 429s took minimax from rpm 60 to an
 * effective rpm of 3, and eight concurrent ones pinned deepseek to the MIN_SCALE
 * floor from a single wall. Retries make it worse still, since a retried call
 * that throttles again reports the same congestion a second time.
 */
export const THROTTLE_COOLDOWN_MS = 5_000;

interface TokenEvent {
  at: number;
  amount: number;
}

/**
 * One provider's budget, enforced in memory.
 *
 * KEYED PER PROVIDER, NOT PER TASK OR MODEL. MiniMax pools text, image, speech
 * and music against a single quota, so `image_rank` vision calls and
 * `site_build` page rewrites must draw from the same bucket. A per-task
 * limiter would let two subsystems collide while each believed itself within
 * its allowance — which is precisely the bug this replaces.
 *
 * IN MEMORY IS CORRECT HERE. Production is a single long-lived Node process
 * (`next start` plus the pollers in `instrumentation.ts`). Coordinating this
 * through Postgres would add a round-trip to every call and failure modes for a
 * multi-instance deployment that does not exist. The class boundary is narrow
 * enough that a DB-backed implementation could replace it if that changes.
 *
 * TPD resets on restart, unlike the per-minute windows which self-heal. That is
 * an accepted, documented limitation: only Kimi's lowest tier declares a daily
 * cap and none of the operator's current tiers do. The remaining TPD gap is
 * phase, not arithmetic: the "day" is a tumbling 24h window anchored at first
 * use, so a real `tpd` would drift out of step with the vendor's UTC-midnight
 * reset and could refuse tokens the account had already been given back.
 */
export class ProviderGate {
  private budget: RateBudget;
  private inFlight = 0;
  private requests: number[] = [];
  private tokens: TokenEvent[] = [];
  private dayTokens = 0;
  private dayStartedAt = 0;
  private scale = 1;
  private successStreak = 0;
  private lastThrottleAt = 0;
  private lastRampAt = 0;
  private throttles: number[] = [];
  private readonly estimator = new OutputRatioEstimator();

  constructor(
    readonly key: string,
    budget: RateBudget = {},
  ) {
    this.budget = budget;
  }

  /**
   * Install a new budget, discarding any pacing learned against the old one.
   *
   * An operator who watches a provider throttle and RAISES the ceiling in
   * settings must not be silently overruled by a scale learned before the
   * change: after four 429s, `setBudget({rpm: 600})` used to yield an effective
   * rpm of 37, with no way to clear it short of a process restart. A scale is
   * evidence about a specific ceiling, so a new ceiling invalidates it.
   *
   * The comparison is BY VALUE across the four dimensions and it is
   * load-bearing, not defensive tidiness: the gate registry calls `setBudget` on
   * every single lookup with a freshly built but equal budget, and a
   * reference-identity check would therefore reset the scale on every call and
   * disable adaptation entirely. `throttles` survives a change — it is the
   * operator-facing health signal, not pacing state.
   */
  setBudget(budget: RateBudget): void {
    const changed = (["concurrency", "rpm", "tpm", "tpd"] as const).some((k) => this.budget[k] !== budget[k]);
    this.budget = budget;
    if (!changed) return;
    const before = this.scale;
    this.scale = 1;
    this.successStreak = 0;
    this.lastRampAt = 0;
    if (before < 1) {
      console.warn(`[ai-gate] ${this.key}: budget changed — pacing reset ${before.toFixed(2)} -> 1.00`);
    }
  }

  snapshot(): GateSnapshot {
    const now = Date.now();
    this.prune(now);
    return {
      key: this.key,
      inFlight: this.inFlight,
      requestsThisMinute: this.requests.length,
      tokensThisMinute: this.tokens.reduce((sum, t) => sum + t.amount, 0),
      dayTokens: this.dayTokens,
      // The EFFECTIVE scale, not the stored one, so an operator reading this
      // sees the pacing actually in force rather than the last value some call
      // happened to write. Recovery is lazy (see `effectiveScale`), so on an
      // idle gate the stored field is stale by construction.
      scale: this.effectiveScale(now),
      throttlesLastHour: this.throttles.length,
      lastThrottleAt: this.lastThrottleAt || null,
    };
  }

  /** Drop everything that has aged out of its window, and roll the day if the
   *  24h tumbling window has elapsed. Rolling here rather than only in
   *  `msUntilCapacity` means an idle gate never reports yesterday's tokens. */
  private prune(now: number): void {
    const from = now - WINDOW_MS;
    while (this.requests.length && this.requests[0] <= from) this.requests.shift();
    while (this.tokens.length && this.tokens[0].at <= from) this.tokens.shift();
    const hourAgo = now - 60 * 60 * 1000;
    while (this.throttles.length && this.throttles[0] <= hourAgo) this.throttles.shift();
    if (this.dayStartedAt === 0 || now - this.dayStartedAt >= DAY_MS) {
      this.dayStartedAt = now;
      this.dayTokens = 0;
    }
  }

  /**
   * The scale actually in force, ramping it back up for any quiet periods that
   * have elapsed since the last throttle or ramp.
   *
   * RECOVERY MUST NOT REQUIRE SUCCESSFUL TRAFFIC. The success-streak path only
   * runs from `settle`, so a gate that backed off and then went quiet — exactly
   * what happens when a burst of 429s lands at the END of a generation — stayed
   * collapsed with nothing left to un-collapse it, and the NEXT run started at
   * the collapsed scale. Evaluating time-based recovery lazily on read fixes
   * that without a timer: an idle gate heals, and the healing is observed the
   * moment anyone asks.
   */
  private effectiveScale(now: number): number {
    if (this.scale < 1) {
      const since = Math.max(this.lastThrottleAt, this.lastRampAt);
      const steps = Math.floor((now - since) / RAMP_QUIET_MS);
      if (steps > 0) {
        this.scale = Math.min(1, this.scale + steps * RAMP_STEP);
        this.lastRampAt = now;
      }
    }
    return this.scale;
  }

  /**
   * How long until there is room for `reserve` tokens — 0 when there is room
   * now — and which dimension is responsible for any wait. Dimensions the
   * provider did not declare are skipped entirely, never defaulted (see
   * limits.ts).
   */
  private msUntilCapacity(reserve: number, now: number): { waitMs: number; dimension: GateDimension | null } {
    this.prune(now);
    const b = scaleBudget(this.budget, this.effectiveScale(now));

    if (b.concurrency !== undefined && this.inFlight >= b.concurrency) {
      return { waitMs: GATE_POLL_MS, dimension: "concurrency" };
    }

    if (b.rpm !== undefined && this.requests.length >= b.rpm) {
      return { waitMs: Math.max(1, this.requests[0] + WINDOW_MS - now), dimension: "rpm" };
    }

    if (b.tpm !== undefined) {
      const used = this.tokens.reduce((sum, t) => sum + t.amount, 0);
      if (used + reserve > b.tpm) {
        // A single call larger than the entire per-minute budget can never fit.
        // Waiting for room that will never exist is a permanent deadlock, so an
        // otherwise-idle gate lets it through and lets the vendor decide.
        if (this.tokens.length === 0) return { waitMs: 0, dimension: null };
        return { waitMs: Math.max(1, this.tokens[0].at + WINDOW_MS - now), dimension: "tpm" };
      }
    }

    if (b.tpd !== undefined && this.dayTokens + reserve > b.tpd) {
      return { waitMs: Math.max(1, this.dayStartedAt + DAY_MS - now), dimension: "tpd" };
    }

    return { waitMs: 0, dimension: null };
  }

  /** What this call should reserve: its input, plus the learned output ratio,
   *  never more than the output budget actually requested. */
  private reservationFor(inputTokens: number, model: string, maxTokens: number): number {
    const ratio = this.estimator.ratio(`${this.key}:${model}`);
    return inputTokens + Math.min(maxTokens, Math.ceil(inputTokens * ratio));
  }

  /**
   * Wait for budget, then take a slot. Resolves only once the call is cleared
   * to go; rejects on abort, or on `maxWaitMs` being exceeded.
   *
   * `maxWaitMs` IS THE ONLY BOUND ON THIS WAIT. `run.ts`'s per-call timeout
   * starts once the request is on the wire, so it does not cover time spent
   * parked here. Without a deadline a TPD block computes a wait of up to a full
   * day and dutifully polls it out — a caller silently parked for 24 hours
   * across ~86,400 wakeups. Callers that would rather fail than wait forever
   * pass a deadline; the default remains "wait", since the common case is
   * a few seconds of ordinary pacing.
   */
  async acquire(
    request: { inputTokens: number; model: string; maxTokens: number },
    signal?: AbortSignal,
    maxWaitMs?: number,
  ): Promise<GateSlot> {
    // Computed ONCE, deliberately: a caller parked for a minute keeps the
    // reservation it queued with rather than having it re-estimated underneath
    // it, so a waiter's cost cannot grow while it waits and push it back down
    // the queue it is already at the front of.
    const reserve = this.reservationFor(request.inputTokens, request.model, request.maxTokens);
    const startedAt = Date.now();
    let warned = false;

    for (;;) {
      if (signal?.aborted) throw new AiCallAborted(`${this.key} rate gate`, signal.reason);
      const now = Date.now();
      const { waitMs, dimension } = this.msUntilCapacity(reserve, now);
      if (waitMs === 0) return this.commit(reserve, request.model, now);

      const waited = now - startedAt;
      if (maxWaitMs !== undefined && waited >= maxWaitMs) {
        throw new GateTimeoutError(this.key, dimension, waited);
      }
      if (!warned && waited >= GATE_SLOW_WAIT_WARN_MS) {
        // Once per acquire, not once per poll: at a 50ms poll this would
        // otherwise be twenty lines a second for as long as the block lasts.
        warned = true;
        console.warn(
          `[ai-gate] ${this.key}: a call has waited ${Math.round(waited / 1000)}s for budget ` +
            `(blocked on ${dimension ?? "budget"})`,
        );
      }

      const slices = [waitMs, MAX_WAIT_SLICE_MS];
      // Never sleep past the deadline, or a 100ms budget would be reported as
      // having waited a full second.
      if (maxWaitMs !== undefined) slices.push(Math.max(1, maxWaitMs - waited));
      await sleep(Math.min(...slices), signal, `${this.key} rate gate`);
    }
  }

  private commit(reserve: number, model: string, now: number): GateSlot {
    this.inFlight += 1;
    this.requests.push(now);
    const event: TokenEvent = { at: now, amount: reserve };
    this.tokens.push(event);
    this.dayTokens += reserve;
    // Which 24h window this reservation was charged to. `settle` reconciles by
    // delta, so without this a call straddling a rollover would apply its
    // correction to the fresh day and hand it a false credit.
    const committedDayAt = this.dayStartedAt;

    let settled = false;
    const release = () => {
      if (settled) return false;
      settled = true;
      this.inFlight = Math.max(0, this.inFlight - 1);
      return true;
    };

    return {
      settle: (usage) => {
        if (!release()) return;
        const actual = usage?.total_tokens;
        if (typeof actual === "number" && Number.isFinite(actual) && actual >= 0) {
          const settledAt = Date.now();
          const excess = actual - event.amount;
          // Only reconcile the day counter if we are still in the day we were
          // charged to; otherwise the delta belongs to a window that is gone.
          if (this.dayStartedAt === committedDayAt) this.dayTokens += excess;
          // A call can outlive the 60s window — a model-max page rewrite
          // routinely does. By the time it settles its reservation has been
          // pruned, so correcting `event.amount` alone charges the overspend to
          // no minute at all: a 22k reservation settling at 410k left 388k
          // entirely unaccounted, free to blow the very TPM ceiling this exists
          // to hold. Bill the excess to the minute it actually landed in.
          // Appending at `settledAt` also keeps `tokens` ordered by `at`, which
          // `prune`'s shift-from-the-front loop depends on.
          if (excess > 0 && settledAt - event.at >= WINDOW_MS) {
            this.tokens.push({ at: settledAt, amount: excess });
          }
          event.amount = actual;
        }
        const ratio = outputRatioFrom(usage);
        if (ratio !== null) this.estimator.record(`${this.key}:${model}`, ratio);
        this.recordSuccess(Date.now());
      },
      settleError: (error, opts) => {
        if (!release()) return;
        // `isRateLimitError` is a boolean check, not a type predicate, so the
        // cast is what carries the narrowing it already proved: it matched a
        // 429 status, which only a `ProviderHttpError` — or a same-shaped copy
        // that crossed a module boundary — carries. `recordThrottle` reads
        // only diagnostic fields off it, and reads them for a log line, so a
        // copy missing one degrades that line rather than the pacing decision.
        if (isRateLimitError(error)) {
          this.recordThrottle(Date.now(), error as ProviderHttpError, opts?.sameCongestionEvent === true);
        }
      },
    };
  }

  /** Earn a ramp step by volume. The other half of recovery — earning one by
   *  elapsed quiet time — lives in `effectiveScale`, so that a gate with no
   *  traffic at all still heals. */
  private recordSuccess(now: number): void {
    this.successStreak += 1;
    if (this.scale < 1 && this.successStreak >= RAMP_SUCCESS_STREAK) {
      this.scale = Math.min(1, this.scale + RAMP_STEP);
      this.successStreak = 0;
      this.lastRampAt = now;
    }
  }

  private recordThrottle(now: number, error: ProviderHttpError, sameCongestionEvent = false): void {
    this.successStreak = 0;
    this.throttles.push(now);
    // TWO ways a 429 is recognised as a repeat of a wall already counted, and
    // both are needed because they cover cases the other cannot reach:
    //
    //  - ASSERTED by the caller. The retry loop in run.ts knows for a fact that
    //    attempts 2..n are one call hitting one wall, however far apart they
    //    land. It has to say so, because the spacing is VENDOR-CONTROLLED: a
    //    polite `Retry-After: 10` puts four attempts 10s apart, so inferring
    //    identity from proximity gets it exactly backwards and punishes the
    //    vendor that warned us — measured at 1.00 -> 0.06 from a single call,
    //    the very compounding this cooldown was introduced to stop.
    //  - INFERRED from proximity. This is what the flag cannot see: DIFFERENT
    //    concurrent calls hitting the wall together. Six pages of a site each
    //    report their own attempt 1, so every one of them arrives with the flag
    //    false and only their closeness in time marks them as one fact.
    const sameEvent =
      sameCongestionEvent || (this.lastThrottleAt > 0 && now - this.lastThrottleAt < THROTTLE_COOLDOWN_MS);
    // Advanced even for a duplicate: it dates the congestion, and the quiet
    // ramp must count from the LAST 429 seen, not the first of a burst.
    this.lastThrottleAt = now;
    if (sameEvent) return;
    const before = this.scale;
    this.scale = Math.max(MIN_SCALE, this.scale * THROTTLE_BACKOFF_FACTOR);
    // The one log line that explains a slow generation. Includes whatever the
    // vendor volunteered: `Retry-After` (which also drives the caller's backoff)
    // and the `x-ratelimit-*` trio, which only Gemini documents — captured here
    // as a diagnostic rather than fed back into the budget, because a bare
    // `x-ratelimit-limit` does not say WHICH dimension it describes.
    const detail = [
      // `typeof`, not `!== null`: a same-shaped copy that crossed a module
      // boundary can be missing the field entirely, and `undefined !== null`
      // would print "NaN" — the defensive read matches errors.ts's own.
      typeof error.retryAfterMs === "number" ? `vendor asked for ${Math.round(error.retryAfterMs / 1000)}s` : null,
      error.rateLimit?.limit !== undefined ? `limit ${error.rateLimit.limit}` : null,
      error.rateLimit?.remaining !== undefined ? `remaining ${error.rateLimit.remaining}` : null,
    ].filter(Boolean);
    console.warn(
      `[ai-gate] ${this.key}: HTTP 429 — pacing ${before.toFixed(2)} -> ${this.scale.toFixed(2)}` +
        (detail.length ? ` (${detail.join(", ")})` : ""),
    );
  }
}

/* ----------------------------------------------------------- the registry */

/**
 * Process-wide gates, one per provider key.
 *
 * Module-level state is the point: every AI call in the app must draw from the
 * SAME bucket per provider, whichever subsystem made it. A gate created per
 * request would enforce nothing.
 *
 * ONE MAP PER NODE MODULE REGISTRY, which is the assumption this rests on.
 * Production is a single `next start` process and every route here pins the
 * nodejs runtime, so there is exactly one. Dev HMR mints a fresh Map on edit —
 * harmless, it just forgets the learned pacing. But putting a caller behind a
 * second server runtime (an edge route, a separately bundled entry) would give
 * that caller its OWN Map and therefore its own full budget, so the vendor
 * would see double. The failure mode is over-admission, not deadlock, but it
 * would silently undo this subsystem — check this assumption before moving any
 * AI call off the nodejs runtime.
 */
const gates = new Map<string, ProviderGate>();

/**
 * The gate for a provider, creating it on first use. An existing gate has its
 * budget UPDATED rather than being replaced — replacing it would discard the
 * in-flight count and the learned adaptive scale every time an operator saved
 * a settings change, which is exactly when accurate state matters most.
 *
 * OMITTING `budget` means "put me in this provider's bucket" WITHOUT also
 * asserting what that bucket's budget is. The legacy env-keyed path
 * (`callProvider` in lib/ai-tools/run.ts) knows the provider but has no access
 * to the operator's stored override, so the best it could otherwise state is
 * the shipped default. That would differ from the routed path's
 * default-plus-override on any tuned provider, and since `setBudget` resets the
 * learned adaptive state whenever the budget CHANGES, the two callers
 * alternating would reset it on every call — switching AIMD backoff off
 * entirely, on precisely the providers an operator cared enough to tune.
 *
 * ACCEPTED CONSEQUENCE: if a budget-less caller is the FIRST to touch a
 * provider in a fresh process, the gate is created unpaced (`{}`) and stays so
 * until the first routed call installs the real budget. That window is brief
 * and self-correcting, and it is strictly better than two budgets fighting.
 */
export function getGate(providerKey: string, budget?: RateBudget): ProviderGate {
  const existing = gates.get(providerKey);
  if (existing) {
    if (budget !== undefined) existing.setBudget(budget);
    return existing;
  }
  const created = new ProviderGate(providerKey, budget ?? {});
  gates.set(providerKey, created);
  return created;
}

/** Every live gate's state, for the admin screen. */
export function gateSnapshots(): GateSnapshot[] {
  return [...gates.values()].map((g) => g.snapshot());
}

/**
 * Drop all gates. TESTS ONLY — and the restriction is a correctness one, not a
 * convention. Clearing the map orphans the `inFlight` counters of calls that
 * are still outstanding, so the replacement gates would over-admit by exactly
 * that many requests — the failure this subsystem exists to prevent.
 *
 * An operator's settings change needs no reset: `getGate` re-applies the
 * budget on every lookup, so an edit takes effect on the very next call. That
 * is why there is no production counterpart here to `clearTaskModelCache`
 * (providers/run.ts), which exists only because that memo caches a DB read.
 */
export function resetGates(): void {
  gates.clear();
}
