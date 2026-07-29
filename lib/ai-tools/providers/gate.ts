/**
 * Token estimation for TPM accounting.
 *
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
import { isRateLimitError, ProviderHttpError } from "./errors";
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

/** Delay before a blocked caller re-checks, capped so a long computed wait
 *  still notices an abort promptly. */
export const MAX_WAIT_SLICE_MS = 1000;

export interface GateSlot {
  /** The call succeeded: reconcile the token reservation against what was
   *  really spent, feed the ratio estimator, and count toward ramp-up. */
  settle(usage: TokenUsage | null): void;
  /** The call failed: release the slot, and if it was throttled, halve the
   *  provider's effective budget. */
  settleError(error: unknown): void;
}

export interface GateSnapshot {
  key: string;
  inFlight: number;
  requestsThisMinute: number;
  tokensThisMinute: number;
  /** Current adaptive multiplier applied to the resolved budget. */
  scale: number;
  /** 429s seen in the last hour — the operator-facing health signal. */
  throttlesLastHour: number;
  lastThrottleAt: number | null;
}

/** Sleep that an abort can cut short, so a Stop is honoured while a caller is
 *  parked waiting for budget rather than only while it is on the wire. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AiCallAborted("rate gate", signal.reason));
      return;
    }
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new AiCallAborted("rate gate", signal?.reason));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Multiplier applied to the budget on each 429. */
export const THROTTLE_BACKOFF_FACTOR = 0.5;
/** Additive step when recovering. */
export const RAMP_STEP = 0.1;
/** Consecutive successes that earn a ramp step. */
export const RAMP_SUCCESS_STREAK = 20;
/** Quiet period (no 429) that earns a ramp step on its own. */
export const RAMP_QUIET_MS = 60_000;

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
 * cap and none of the operator's current tiers do.
 *
 * A SECOND, NARROWER TPD LIMITATION, measured rather than assumed: `settle`
 * reconciles by applying `actual - reserved` to `dayTokens`, so a call that was
 * committed before a day rollover and settles after one applies that delta to
 * the FRESH day's counter. When the call under-ran its reservation the delta is
 * negative, and the new day starts with a small false credit (a 22k reservation
 * settling at 11k leaves `dayTokens` at -11k). Latent, not live: it needs `tpd`
 * declared — no shipped default in limits.ts declares one, only an operator
 * override can — AND a call in flight across the exact boundary. Fixing it
 * properly means stamping each event with the day epoch it was committed under,
 * which is not worth the complexity until a provider's `tpd` is real. Note this
 * does NOT affect the ordinary case of a call outliving the 60s TPM window:
 * `dayTokens` is a scalar accumulator, so it still nets to the true spend even
 * though `prune` has already dropped the event from the per-minute ledger.
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

  setBudget(budget: RateBudget): void {
    this.budget = budget;
  }

  snapshot(): GateSnapshot {
    const now = Date.now();
    this.prune(now);
    return {
      key: this.key,
      inFlight: this.inFlight,
      requestsThisMinute: this.requests.length,
      tokensThisMinute: this.tokens.reduce((sum, t) => sum + t.amount, 0),
      scale: this.scale,
      throttlesLastHour: this.throttles.length,
      lastThrottleAt: this.lastThrottleAt || null,
    };
  }

  private prune(now: number): void {
    const from = now - WINDOW_MS;
    while (this.requests.length && this.requests[0] <= from) this.requests.shift();
    while (this.tokens.length && this.tokens[0].at <= from) this.tokens.shift();
    const hourAgo = now - 60 * 60 * 1000;
    while (this.throttles.length && this.throttles[0] <= hourAgo) this.throttles.shift();
  }

  /**
   * Milliseconds until there is room for `reserve` tokens, or 0 when there is
   * room now. Dimensions the provider did not declare are skipped entirely —
   * never defaulted (see limits.ts).
   */
  private msUntilCapacity(reserve: number, now: number): number {
    const b = scaleBudget(this.budget, this.scale);
    this.prune(now);

    if (b.concurrency !== undefined && this.inFlight >= b.concurrency) return GATE_POLL_MS;

    if (b.rpm !== undefined && this.requests.length >= b.rpm) {
      return Math.max(1, this.requests[0] + WINDOW_MS - now);
    }

    if (b.tpm !== undefined) {
      const used = this.tokens.reduce((sum, t) => sum + t.amount, 0);
      if (used + reserve > b.tpm) {
        // A single call larger than the entire per-minute budget can never fit.
        // Waiting for room that will never exist is a permanent deadlock, so an
        // otherwise-idle gate lets it through and lets the vendor decide.
        if (this.tokens.length === 0) return 0;
        return Math.max(1, this.tokens[0].at + WINDOW_MS - now);
      }
    }

    if (b.tpd !== undefined) {
      if (this.dayStartedAt === 0 || now - this.dayStartedAt >= DAY_MS) {
        this.dayStartedAt = now;
        this.dayTokens = 0;
      }
      if (this.dayTokens + reserve > b.tpd) return Math.max(1, this.dayStartedAt + DAY_MS - now);
    }

    return 0;
  }

  /** What this call should reserve: its input, plus the learned output ratio,
   *  never more than the output budget actually requested. */
  private reservationFor(inputTokens: number, model: string, maxTokens: number): number {
    const ratio = this.estimator.ratio(`${this.key}:${model}`);
    return inputTokens + Math.min(maxTokens, Math.ceil(inputTokens * ratio));
  }

  async acquire(
    request: { inputTokens: number; model: string; maxTokens: number },
    signal?: AbortSignal,
  ): Promise<GateSlot> {
    const reserve = this.reservationFor(request.inputTokens, request.model, request.maxTokens);

    for (;;) {
      if (signal?.aborted) throw new AiCallAborted(`${this.key} rate gate`, signal.reason);
      const now = Date.now();
      const wait = this.msUntilCapacity(reserve, now);
      if (wait === 0) return this.commit(reserve, request.model, now);
      await sleep(Math.min(wait, MAX_WAIT_SLICE_MS), signal);
    }
  }

  private commit(reserve: number, model: string, now: number): GateSlot {
    this.inFlight += 1;
    this.requests.push(now);
    const event: TokenEvent = { at: now, amount: reserve };
    this.tokens.push(event);
    this.dayTokens += reserve;

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
          this.dayTokens += actual - event.amount;
          event.amount = actual;
        }
        const ratio = outputRatioFrom(usage);
        if (ratio !== null) this.estimator.record(`${this.key}:${model}`, ratio);
        this.recordSuccess(Date.now());
      },
      settleError: (error) => {
        if (!release()) return;
        // `isRateLimitError` is a boolean check, not a type predicate, so the
        // cast is what carries the narrowing it already proved: it matched a
        // 429 status, which only a `ProviderHttpError` — or a same-shaped copy
        // that crossed a module boundary — carries. `recordThrottle` reads
        // only diagnostic fields off it, and reads them for a log line, so a
        // copy missing one degrades that line rather than the pacing decision.
        if (isRateLimitError(error)) this.recordThrottle(Date.now(), error as ProviderHttpError);
      },
    };
  }

  private recordSuccess(now: number): void {
    this.successStreak += 1;
    const quiet =
      this.lastThrottleAt > 0 && now - this.lastThrottleAt >= RAMP_QUIET_MS && now - this.lastRampAt >= RAMP_QUIET_MS;
    if (this.scale < 1 && (this.successStreak >= RAMP_SUCCESS_STREAK || quiet)) {
      this.scale = Math.min(1, this.scale + RAMP_STEP);
      this.successStreak = 0;
      this.lastRampAt = now;
    }
  }

  private recordThrottle(now: number, error: ProviderHttpError): void {
    this.successStreak = 0;
    this.lastThrottleAt = now;
    this.throttles.push(now);
    const before = this.scale;
    this.scale = Math.max(MIN_SCALE, this.scale * THROTTLE_BACKOFF_FACTOR);
    // The one log line that explains a slow generation. Includes whatever the
    // vendor volunteered: `Retry-After` (which also drives the caller's backoff)
    // and the `x-ratelimit-*` trio, which only Gemini documents — captured here
    // as a diagnostic rather than fed back into the budget, because a bare
    // `x-ratelimit-limit` does not say WHICH dimension it describes.
    const detail = [
      error.retryAfterMs !== null ? `vendor asked for ${Math.round(error.retryAfterMs / 1000)}s` : null,
      error.rateLimit?.limit !== undefined ? `limit ${error.rateLimit.limit}` : null,
      error.rateLimit?.remaining !== undefined ? `remaining ${error.rateLimit.remaining}` : null,
    ].filter(Boolean);
    console.warn(
      `[ai-gate] ${this.key}: HTTP 429 — pacing ${before.toFixed(2)} -> ${this.scale.toFixed(2)}` +
        (detail.length ? ` (${detail.join(", ")})` : ""),
    );
  }
}
