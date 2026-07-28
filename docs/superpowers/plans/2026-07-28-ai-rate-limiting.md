# AI Provider Rate Limiting and Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Site Builder generations from failing with HTTP 429 by pacing every AI call in the app behind a per-provider budget and retrying throttled calls instead of failing them.

**Architecture:** Three new pure-ish modules under `lib/ai-tools/providers/` — a budget model (`limits.ts`), a typed error layer (`errors.ts`), and an in-memory per-provider gate (`gate.ts`) — plus changes to the single shared call seam `callWithProvider` in `lib/ai-tools/run.ts`. Because every subsystem (Site Builder, Site Studio, template engine, image ranking) already funnels through that seam, no caller needs editing. Production is a single long-lived Node process, so the gate is in-memory.

**Tech Stack:** TypeScript, Next.js 16, Supabase (Postgres), Vitest, Zod, React.

**Spec:** `docs/superpowers/specs/2026-07-28-ai-rate-limiting-design.md`

---

## File Structure

**Create:**
- `lib/ai-tools/providers/errors.ts` — `ProviderHttpError`, `Retry-After` parsing, retryable/terminal classification. No imports beyond `abort.ts`.
- `lib/ai-tools/providers/limits.ts` — `RateBudget`, per-provider defaults, override resolution, AIMD scaling. Pure; no I/O.
- `lib/ai-tools/providers/gate.ts` — `ProviderGate` (concurrency, RPM, TPM, TPD, adaptive scale, token estimation) and the process-wide gate registry. In-memory; no I/O.
- `supabase/migrations/0062_ai_provider_rate_limits.sql` — one nullable `jsonb` column.
- `tests/aiProviderErrors.test.ts`, `tests/aiProviderLimits.test.ts`, `tests/aiProviderGate.test.ts`, `tests/aiProviderRetry.test.ts`

**Modify:**
- `lib/ai-tools/run.ts` — `ProviderSpec` gains `providerKey`/`rateBudget`; `callWithProvider` throws typed errors, acquires from the gate, and retries.
- `lib/ai-tools/providers/run.ts` — `callForTask` stops falling back to the default provider on a rate limit.
- `lib/ai-tools/providers/config.ts` — `readProviderRows` switched to `select("*")`; `rate_limits` read/written; `specFor` populates the two new `ProviderSpec` fields.
- `lib/ai-tools/providers/adminView.ts` — expose resolved budget + live gate state.
- `app/api/admin/ai-providers/route.ts` — accept a `rate_limits` payload.
- `components/ai-models/AiModelManager.tsx` — the operator-facing form.
- `app/api/site-builder/runs/[id]/generate/route.ts` — raise `maxDuration`.

Tasks 1–5 build the primitives bottom-up with no dependency on the rest of the app. Tasks 6–9 wire them into the call path — after Task 9 the 429 problem is fixed and the feature works end to end. Tasks 10–13 add operator control and are independently useful but not required for correctness.

---

### Task 1: Typed provider errors

**Files:**
- Create: `lib/ai-tools/providers/errors.ts`
- Test: `tests/aiProviderErrors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/aiProviderErrors.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  ProviderHttpError,
  parseRetryAfter,
  rateLimitHeadersFrom,
  isRetryableError,
  isRateLimitError,
} from "@/lib/ai-tools/providers/errors";
import { AiCallAborted } from "@/lib/ai-tools/abort";

describe("parseRetryAfter", () => {
  it("reads delta-seconds", () => {
    expect(parseRetryAfter("30")).toBe(30_000);
    expect(parseRetryAfter("  5 ")).toBe(5_000);
  });

  it("reads an HTTP-date relative to now", () => {
    const now = Date.parse("2026-07-28T12:00:00Z");
    expect(parseRetryAfter("Tue, 28 Jul 2026 12:00:20 GMT", now)).toBe(20_000);
  });

  it("never returns a negative wait for a past HTTP-date", () => {
    const now = Date.parse("2026-07-28T12:00:00Z");
    expect(parseRetryAfter("Tue, 28 Jul 2026 11:59:00 GMT", now)).toBe(0);
  });

  it("returns null for absent or unparseable values", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
  });
});

describe("rateLimitHeadersFrom", () => {
  it("reads the x-ratelimit trio when present", () => {
    const h = new Headers({
      "x-ratelimit-limit": "500",
      "x-ratelimit-remaining": "12",
      "x-ratelimit-reset": "30",
    });
    expect(rateLimitHeadersFrom(h)).toEqual({ limit: 500, remaining: 12, resetMs: 30_000 });
  });

  it("returns null when the vendor sends none of them", () => {
    expect(rateLimitHeadersFrom(new Headers({ "content-type": "application/json" }))).toBeNull();
  });
});

describe("classification", () => {
  const err = (status: number) => new ProviderHttpError("boom", status, null, null);

  it("treats throttling and transient server faults as retryable", () => {
    for (const s of [408, 429, 500, 502, 503, 504]) expect(isRetryableError(err(s))).toBe(true);
  });

  it("treats request and auth faults as terminal", () => {
    for (const s of [400, 401, 403, 404, 413, 422]) expect(isRetryableError(err(s))).toBe(false);
  });

  it("treats a call timeout and a network fault as retryable", () => {
    expect(isRetryableError(new Error("MiniMax M3 call timed out after 300s"))).toBe(true);
    const net = new Error("fetch failed") as NodeJS.ErrnoException;
    net.code = "ECONNRESET";
    expect(isRetryableError(net)).toBe(true);
  });

  it("never retries an operator abort", () => {
    expect(isRetryableError(new AiCallAborted("MiniMax M3"))).toBe(false);
  });

  it("identifies a rate limit specifically", () => {
    expect(isRateLimitError(err(429))).toBe(true);
    expect(isRateLimitError(err(503))).toBe(false);
    expect(isRateLimitError(new Error("nope"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/aiProviderErrors.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/ai-tools/providers/errors"`

- [ ] **Step 3: Write minimal implementation**

Create `lib/ai-tools/providers/errors.ts`:

```ts
import { isAbortedError } from "@/lib/ai-tools/abort";

/**
 * Typed provider failures.
 *
 * WHY THIS EXISTS: `callWithProvider` used to collapse every non-OK response
 * into `throw new Error(msg)`, discarding the HTTP status. Nothing downstream
 * could then tell a 429 (wait and retry — the call would have succeeded) from
 * a 400 (retrying burns quota and can never succeed). That single lost integer
 * is why rate limiting presented as permanent page failure.
 */

export interface RateLimitHeaders {
  limit?: number;
  remaining?: number;
  /** Milliseconds until the window resets, when the vendor says so. */
  resetMs?: number;
}

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs: number | null,
    readonly rateLimit: RateLimitHeaders | null,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

/**
 * RFC 9110 `Retry-After`: either delta-seconds or an HTTP-date. Both forms are
 * seen in the wild, and a vendor may switch between them without notice, so
 * both are handled. A date already in the past yields 0, never a negative
 * wait that would read as "retry before you asked".
 */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  }
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

const numberHeader = (headers: Headers, name: string): number | undefined => {
  const raw = headers.get(name);
  if (raw === null) return undefined;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : undefined;
};

/**
 * The `x-ratelimit-*` trio, when the vendor sends it. Verified 2026-07-28:
 * of the four providers this app supports, ONLY Gemini documents these. They
 * are therefore read opportunistically to refine a budget we already hold —
 * never as the source of one. See the spec's vendor table.
 */
export function rateLimitHeadersFrom(headers: Headers): RateLimitHeaders | null {
  const limit = numberHeader(headers, "x-ratelimit-limit");
  const remaining = numberHeader(headers, "x-ratelimit-remaining");
  const resetSeconds = numberHeader(headers, "x-ratelimit-reset");
  if (limit === undefined && remaining === undefined && resetSeconds === undefined) return null;
  const out: RateLimitHeaders = {};
  if (limit !== undefined) out.limit = limit;
  if (remaining !== undefined) out.remaining = remaining;
  if (resetSeconds !== undefined) out.resetMs = resetSeconds * 1000;
  return out;
}

/** 408 is included alongside the spec's list: a server-side request timeout is
 *  exactly as transient as a 503, and retrying it is free of side effects. */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const RETRYABLE_NET_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "EPIPE", "ENOTFOUND"]);

/**
 * Is retrying this failure capable of succeeding? A terminal failure (bad
 * request, bad key, model not found) cannot, and retrying it spends quota a
 * concurrent run needs. An operator abort is never retried — that is
 * disobedience, not resilience (see abort.ts).
 */
export function isRetryableError(e: unknown): boolean {
  if (isAbortedError(e)) return false;
  if (e instanceof ProviderHttpError) return RETRYABLE_STATUS.has(e.status);
  if (e instanceof Error) {
    if (/ call timed out after /.test(e.message)) return true;
    if (e.name === "TypeError") return true; // undici surfaces network failure this way
    const code = (e as NodeJS.ErrnoException).code;
    if (typeof code === "string" && RETRYABLE_NET_CODES.has(code)) return true;
  }
  return false;
}

/** Specifically throttled — the one failure that must adapt the gate's budget
 *  and must NOT trigger provider fallback (see providers/run.ts). */
export function isRateLimitError(e: unknown): boolean {
  return e instanceof ProviderHttpError && e.status === 429;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/aiProviderErrors.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 5: Commit**

```bash
git add lib/ai-tools/providers/errors.ts tests/aiProviderErrors.test.ts
git commit -m "feat(ai-tools): type provider failures so a 429 is distinguishable from a 400"
```

---

### Task 2: The rate budget model

**Files:**
- Create: `lib/ai-tools/providers/limits.ts`
- Test: `tests/aiProviderLimits.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/aiProviderLimits.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  DEFAULT_RATE_BUDGETS,
  MIN_SCALE,
  resolveBudget,
  scaleBudget,
  type RateBudget,
} from "@/lib/ai-tools/providers/limits";

describe("resolveBudget", () => {
  it("uses the shipped default when there is no override", () => {
    expect(resolveBudget("minimax", null)).toEqual(DEFAULT_RATE_BUDGETS.minimax);
  });

  it("returns an empty budget for an unknown provider rather than inventing one", () => {
    expect(resolveBudget("nobody", null)).toEqual({});
  });

  it("lets an operator raise a dimension", () => {
    expect(resolveBudget("webcraft", { concurrency: 100, rpm: 500 })).toMatchObject({
      concurrency: 100,
      rpm: 500,
    });
  });

  it("treats an explicit null as 'this vendor does not limit that dimension'", () => {
    const out = resolveBudget("webcraft", { concurrency: null });
    expect(out.concurrency).toBeUndefined();
    expect(out.rpm).toBe(DEFAULT_RATE_BUDGETS.webcraft.rpm);
  });

  it("ignores nonsense rather than throttling to zero", () => {
    const out = resolveBudget("minimax", { rpm: 0, tpm: Number.NaN });
    expect(out.rpm).toBe(DEFAULT_RATE_BUDGETS.minimax.rpm);
    expect(out.tpm).toBe(DEFAULT_RATE_BUDGETS.minimax.tpm);
  });

  it("leaves an absent dimension absent — DeepSeek documents no RPM", () => {
    expect(DEFAULT_RATE_BUDGETS.deepseek.rpm).toBeUndefined();
    expect(resolveBudget("deepseek", null).rpm).toBeUndefined();
  });
});

describe("scaleBudget", () => {
  const budget: RateBudget = { concurrency: 10, rpm: 100, tpm: 1_000_000, tpd: 5_000_000 };

  it("is a no-op at full scale", () => {
    expect(scaleBudget(budget, 1)).toEqual(budget);
  });

  it("shrinks the per-minute dimensions", () => {
    expect(scaleBudget(budget, 0.5)).toMatchObject({ concurrency: 5, rpm: 50, tpm: 500_000 });
  });

  it("never scales a daily cap — a quota is absolute, not a rate", () => {
    expect(scaleBudget(budget, 0.25).tpd).toBe(5_000_000);
  });

  it("floors every scaled dimension at 1 so the gate can never wedge", () => {
    const tiny = scaleBudget({ concurrency: 2, rpm: 3 }, MIN_SCALE);
    expect(tiny.concurrency).toBeGreaterThanOrEqual(1);
    expect(tiny.rpm).toBeGreaterThanOrEqual(1);
  });

  it("clamps a scale above 1 — adaptation may only lower a stated limit", () => {
    expect(scaleBudget(budget, 5)).toEqual(budget);
  });

  it("leaves undeclared dimensions undeclared", () => {
    expect(scaleBudget({ concurrency: 4 }, 0.5).rpm).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/aiProviderLimits.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/ai-tools/providers/limits"`

- [ ] **Step 3: Write minimal implementation**

Create `lib/ai-tools/providers/limits.ts`:

```ts
/**
 * Per-provider rate budgets.
 *
 * EVERY DIMENSION IS OPTIONAL, and that is the central design decision here.
 * Verified against vendor docs on 2026-07-28: MiniMax limits chat on RPM and
 * TPM and publishes no chat concurrency figure; DeepSeek publishes ONLY a
 * concurrency figure and documents no RPM or TPM; Kimi publishes all four;
 * Gemini publishes RPM, TPM and RPD. A budget type that required all three
 * would force us to invent ceilings no vendor stated, producing a limiter that
 * throttles for reasons that do not exist. Absent means unlimited.
 */

export interface RateBudget {
  /** Maximum simultaneous in-flight requests. */
  concurrency?: number;
  /** Requests per rolling minute. */
  rpm?: number;
  /** Tokens (input + output) per rolling minute. */
  tpm?: number;
  /** Tokens per rolling day. */
  tpd?: number;
}

/**
 * An operator's stored override. A key that is ABSENT means "use the shipped
 * default"; a key present with `null` means "this vendor does not limit that
 * dimension, stop enforcing it". Those are genuinely different intents and the
 * settings UI offers both, so they cannot share one representation.
 */
export type RateBudgetOverride = { [K in keyof RateBudget]?: number | null };

/**
 * Shipped defaults — deliberately CONSERVATIVE, not the published maximum.
 *
 * These are a safe floor that the adaptive layer probes upward from and that an
 * operator raises once they know their tier. Shipping a vendor's top-tier
 * number as the default would reproduce today's bug for anyone on a lower
 * plan, which is the failure this whole subsystem exists to remove.
 */
export const DEFAULT_RATE_BUDGETS: Record<string, RateBudget> = {
  // Docs publish RPM/TPM but no chat concurrency (CONN 20 is Music Generation
  // only). The operator's plan advertises "3-4 concurrent agents", which is a
  // plan-marketing figure rather than an API limit — so concurrency is left
  // undeclared and pacing is done on RPM, which fits the observed failure
  // (several runs succeeding, then throttling) far better.
  minimax: { rpm: 60, tpm: 500_000 },
  // Kimi/Moonshot, keyed "webcraft" in the registry. Tier1 figures; the
  // operator is on Tier2 (100 / 500 / 3M) and can raise these in settings.
  webcraft: { concurrency: 50, rpm: 200, tpm: 2_000_000 },
  // Concurrency-only by documentation. The published figure is per-model and
  // large (500+); this is a house floor, not the vendor ceiling.
  deepseek: { concurrency: 8 },
  gemini: { rpm: 150, tpm: 1_000_000 },
};

/** The floor the adaptive scale may not go below. Keeps at least one request
 *  moving at all times so a throttled provider slows down instead of wedging. */
export const MIN_SCALE = 0.05;

const DIMENSIONS = ["concurrency", "rpm", "tpm", "tpd"] as const;

/**
 * The budget actually in force for a provider: the shipped default, with any
 * operator override applied on top. Anything unusable in the override (zero,
 * negative, NaN) is ignored in favour of the default rather than accepted —
 * a typo in a settings field must not silently throttle generation to nothing.
 */
export function resolveBudget(providerKey: string, override: RateBudgetOverride | null | undefined): RateBudget {
  const out: RateBudget = { ...(DEFAULT_RATE_BUDGETS[providerKey] ?? {}) };
  if (!override) return out;
  for (const key of DIMENSIONS) {
    if (!(key in override)) continue;
    const value = override[key];
    if (value === null) {
      delete out[key];
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value) && value > 0) out[key] = Math.floor(value);
  }
  return out;
}

/**
 * Apply the adaptive scale. Clamped to (MIN_SCALE, 1] because adaptation may
 * only ever LOWER a limit the vendor or operator stated — probing above a
 * known ceiling is how you get throttled, not how you avoid it.
 *
 * TPD is deliberately never scaled: a daily cap is an absolute quota, not a
 * rate. Halving it after a burst 429 would deny the account tokens it is still
 * entitled to spend for the rest of the day.
 */
export function scaleBudget(budget: RateBudget, scale: number): RateBudget {
  const s = Math.min(1, Math.max(MIN_SCALE, scale));
  const out: RateBudget = {};
  if (budget.concurrency !== undefined) out.concurrency = Math.max(1, Math.floor(budget.concurrency * s));
  if (budget.rpm !== undefined) out.rpm = Math.max(1, Math.floor(budget.rpm * s));
  if (budget.tpm !== undefined) out.tpm = Math.max(1, Math.floor(budget.tpm * s));
  if (budget.tpd !== undefined) out.tpd = budget.tpd;
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/aiProviderLimits.test.ts`
Expected: PASS — 12 tests

- [ ] **Step 5: Commit**

```bash
git add lib/ai-tools/providers/limits.ts tests/aiProviderLimits.test.ts
git commit -m "feat(ai-tools): per-provider rate budgets with independently optional dimensions"
```

---

### Task 3: Token estimation

**Files:**
- Create: `lib/ai-tools/providers/gate.ts`
- Test: `tests/aiProviderGate.test.ts`

This task creates `gate.ts` with only its pure estimation helpers. Task 4 adds the gate class to the same file.

- [ ] **Step 1: Write the failing test**

Create `tests/aiProviderGate.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  CHARS_PER_TOKEN,
  IMAGE_TOKEN_ESTIMATE,
  SEED_OUTPUT_RATIO,
  estimateInputTokens,
  outputRatioFrom,
  OutputRatioEstimator,
} from "@/lib/ai-tools/providers/gate";

describe("estimateInputTokens", () => {
  it("counts both prompts at the chars-per-token rate", () => {
    expect(estimateInputTokens("a".repeat(40), "b".repeat(40))).toBe(80 / CHARS_PER_TOKEN);
  });

  it("adds a flat allowance per attached image", () => {
    expect(estimateInputTokens("", "", 3)).toBe(3 * IMAGE_TOKEN_ESTIMATE);
  });

  it("rounds up so a short prompt never estimates as zero", () => {
    expect(estimateInputTokens("ab", "")).toBe(1);
  });
});

describe("outputRatioFrom", () => {
  it("uses completion and prompt tokens when both are reported", () => {
    expect(outputRatioFrom({ prompt_tokens: 1000, completion_tokens: 1500 })).toBe(1.5);
  });

  it("derives completion from total when the vendor omits it", () => {
    expect(outputRatioFrom({ prompt_tokens: 1000, total_tokens: 2500 })).toBe(1.5);
  });

  it("returns null when usage is missing or unusable", () => {
    expect(outputRatioFrom(null)).toBeNull();
    expect(outputRatioFrom({})).toBeNull();
    expect(outputRatioFrom({ prompt_tokens: 0, completion_tokens: 10 })).toBeNull();
  });
});

describe("OutputRatioEstimator", () => {
  it("uses the seed ratio before enough samples exist", () => {
    const est = new OutputRatioEstimator();
    expect(est.ratio("minimax:MiniMax-M3")).toBe(SEED_OUTPUT_RATIO);
    est.record("minimax:MiniMax-M3", 0.2);
    est.record("minimax:MiniMax-M3", 0.2);
    expect(est.ratio("minimax:MiniMax-M3")).toBe(SEED_OUTPUT_RATIO);
  });

  it("switches to the observed p90 once samples accumulate", () => {
    const est = new OutputRatioEstimator();
    for (const r of [0.1, 0.2, 0.3, 0.4, 0.5]) est.record("k", r);
    expect(est.ratio("k")).toBe(0.5);
  });

  it("keeps estimates separate per provider+model", () => {
    const est = new OutputRatioEstimator();
    for (const r of [0.1, 0.1, 0.1]) est.record("a", r);
    expect(est.ratio("a")).toBe(0.1);
    expect(est.ratio("b")).toBe(SEED_OUTPUT_RATIO);
  });

  it("forgets old samples so a changed workload re-calibrates", () => {
    const est = new OutputRatioEstimator();
    for (let i = 0; i < 30; i++) est.record("k", 0.1);
    for (let i = 0; i < 30; i++) est.record("k", 0.9);
    expect(est.ratio("k")).toBeCloseTo(0.9, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/aiProviderGate.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/ai-tools/providers/gate"`

- [ ] **Step 3: Write minimal implementation**

Create `lib/ai-tools/providers/gate.ts`:

```ts
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
  if (typeof prompt !== "number" || prompt <= 0) return null;
  const completion =
    typeof usage.completion_tokens === "number"
      ? usage.completion_tokens
      : typeof usage.total_tokens === "number"
        ? usage.total_tokens - prompt
        : undefined;
  if (typeof completion !== "number" || completion < 0 || !Number.isFinite(completion)) return null;
  return completion / prompt;
}

/** Rolling p90 of observed output ratios, keyed by `${providerKey}:${model}`. */
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
    const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9));
    return sorted[index];
  }

  reset(): void {
    this.samples.clear();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/aiProviderGate.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: Commit**

```bash
git add lib/ai-tools/providers/gate.ts tests/aiProviderGate.test.ts
git commit -m "feat(ai-tools): self-calibrating token estimation for TPM accounting"
```

---

### Task 4: The provider gate — enforcement

**Files:**
- Modify: `lib/ai-tools/providers/gate.ts` (append)
- Test: `tests/aiProviderGate.test.ts` (append)

- [ ] **Step 1: Write the failing test**

First, widen the existing vitest import at the top of `tests/aiProviderGate.test.ts` (created in Task 3) so the timer helpers are available:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
```

Then append to `tests/aiProviderGate.test.ts`:

```ts
import { ProviderGate, sleep } from "@/lib/ai-tools/providers/gate";

describe("ProviderGate enforcement", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not enforce a dimension the provider never declared", async () => {
    const gate = new ProviderGate("deepseek", { concurrency: 2 });
    const slots = await Promise.all([
      gate.acquire({ inputTokens: 10_000_000, model: "m", maxTokens: 1000 }),
      gate.acquire({ inputTokens: 10_000_000, model: "m", maxTokens: 1000 }),
    ]);
    // No tpm declared, so an absurd token count is irrelevant.
    expect(gate.snapshot().inFlight).toBe(2);
    slots.forEach((s) => s.settle(null));
  });

  it("holds callers above the concurrency ceiling", async () => {
    const gate = new ProviderGate("p", { concurrency: 1 });
    const first = await gate.acquire({ inputTokens: 10, model: "m", maxTokens: 10 });
    let secondAcquired = false;
    const second = gate.acquire({ inputTokens: 10, model: "m", maxTokens: 10 }).then((s) => {
      secondAcquired = true;
      return s;
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(secondAcquired).toBe(false);

    first.settle(null);
    await vi.advanceTimersByTimeAsync(200);
    expect(secondAcquired).toBe(true);
    (await second).settle(null);
  });

  it("holds callers once the per-minute request budget is spent", async () => {
    const gate = new ProviderGate("p", { rpm: 2 });
    for (let i = 0; i < 2; i++) (await gate.acquire({ inputTokens: 1, model: "m", maxTokens: 1 })).settle(null);

    let third = false;
    void gate.acquire({ inputTokens: 1, model: "m", maxTokens: 1 }).then((s) => {
      third = true;
      s.settle(null);
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(third).toBe(false);
    await vi.advanceTimersByTimeAsync(31_000); // the first request ages out of the window
    expect(third).toBe(true);
  });

  it("reconciles a reservation against actual usage", async () => {
    const gate = new ProviderGate("p", { tpm: 100_000 });
    const slot = await gate.acquire({ inputTokens: 10_000, model: "m", maxTokens: 50_000 });
    // Reserved 10_000 + 10_000*1.2 = 22_000.
    expect(gate.snapshot().tokensThisMinute).toBe(22_000);
    slot.settle({ prompt_tokens: 10_000, completion_tokens: 1_000, total_tokens: 11_000 });
    expect(gate.snapshot().tokensThisMinute).toBe(11_000);
  });

  it("lets a single call larger than the whole TPM through rather than deadlocking", async () => {
    const gate = new ProviderGate("p", { tpm: 1000 });
    const slot = await gate.acquire({ inputTokens: 500_000, model: "m", maxTokens: 1000 });
    expect(slot).toBeTruthy();
    slot.settle(null);
  });

  it("releases the concurrency slot when the call fails", async () => {
    const gate = new ProviderGate("p", { concurrency: 1 });
    const slot = await gate.acquire({ inputTokens: 1, model: "m", maxTokens: 1 });
    slot.settleError(new Error("boom"));
    expect(gate.snapshot().inFlight).toBe(0);
  });
});

describe("sleep", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("rejects immediately when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(sleep(1000, ac.signal)).rejects.toThrow(/aborted/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/aiProviderGate.test.ts`
Expected: FAIL — `ProviderGate is not exported` / `sleep is not exported`

- [ ] **Step 3: Write minimal implementation**

Append to `lib/ai-tools/providers/gate.ts`:

```ts
import { AiCallAborted } from "@/lib/ai-tools/abort";
import { isRateLimitError, ProviderHttpError } from "./errors";
import { MIN_SCALE, scaleBudget, type RateBudget } from "./limits";

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
        if (isRateLimitError(error)) this.recordThrottle(Date.now(), error);
      },
    };
  }

  private recordSuccess(now: number): void {
    this.successStreak += 1;
    const quiet = this.lastThrottleAt > 0 && now - this.lastThrottleAt >= RAMP_QUIET_MS && now - this.lastRampAt >= RAMP_QUIET_MS;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/aiProviderGate.test.ts`
Expected: PASS — 17 tests

- [ ] **Step 5: Commit**

```bash
git add lib/ai-tools/providers/gate.ts tests/aiProviderGate.test.ts
git commit -m "feat(ai-tools): in-memory per-provider gate for concurrency, RPM, TPM and TPD"
```

---

### Task 5: Adaptive scaling and the gate registry

**Files:**
- Modify: `lib/ai-tools/providers/gate.ts` (append)
- Test: `tests/aiProviderGate.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/aiProviderGate.test.ts`:

```ts
import { getGate, resetGates, gateSnapshots } from "@/lib/ai-tools/providers/gate";
import { ProviderHttpError } from "@/lib/ai-tools/providers/errors";

describe("adaptive scaling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetGates();
  });
  afterEach(() => vi.useRealTimers());

  const throttle = () => new ProviderHttpError("rate limited", 429, null, null);

  it("halves the effective budget on a 429", async () => {
    const gate = new ProviderGate("p", { concurrency: 8 });
    const slot = await gate.acquire({ inputTokens: 1, model: "m", maxTokens: 1 });
    slot.settleError(throttle());
    expect(gate.snapshot().scale).toBeCloseTo(0.5, 5);
  });

  it("never scales below the floor, however many 429s land", async () => {
    const gate = new ProviderGate("p", { concurrency: 8 });
    for (let i = 0; i < 50; i++) {
      const slot = await gate.acquire({ inputTokens: 1, model: "m", maxTokens: 1 });
      slot.settleError(throttle());
    }
    expect(gate.snapshot().scale).toBeGreaterThanOrEqual(0.05);
  });

  it("ramps back up after a streak of successes", async () => {
    const gate = new ProviderGate("p", { concurrency: 40 });
    (await gate.acquire({ inputTokens: 1, model: "m", maxTokens: 1 })).settleError(throttle());
    const after = gate.snapshot().scale;
    for (let i = 0; i < 20; i++) {
      (await gate.acquire({ inputTokens: 1, model: "m", maxTokens: 1 })).settle(null);
    }
    expect(gate.snapshot().scale).toBeGreaterThan(after);
  });

  it("never ramps above full scale", async () => {
    const gate = new ProviderGate("p", { concurrency: 40 });
    for (let i = 0; i < 200; i++) {
      (await gate.acquire({ inputTokens: 1, model: "m", maxTokens: 1 })).settle(null);
    }
    expect(gate.snapshot().scale).toBe(1);
  });

  it("counts throttles for the operator health signal", async () => {
    const gate = new ProviderGate("p", {});
    (await gate.acquire({ inputTokens: 1, model: "m", maxTokens: 1 })).settleError(throttle());
    expect(gate.snapshot().throttlesLastHour).toBe(1);
  });
});

describe("gate registry", () => {
  beforeEach(() => resetGates());

  it("returns the same gate for the same provider key", () => {
    expect(getGate("minimax", {})).toBe(getGate("minimax", {}));
  });

  it("keeps different providers on separate budgets", () => {
    expect(getGate("minimax", {})).not.toBe(getGate("gemini", {}));
  });

  it("updates the budget of an existing gate rather than replacing it", async () => {
    const first = getGate("p", { concurrency: 1 });
    const slot = await first.acquire({ inputTokens: 1, model: "m", maxTokens: 1 });
    const second = getGate("p", { concurrency: 9 });
    expect(second).toBe(first);
    expect(second.snapshot().inFlight).toBe(1);
    slot.settle(null);
  });

  it("reports every live gate for the settings screen", () => {
    getGate("minimax", {});
    getGate("gemini", {});
    expect(gateSnapshots().map((s) => s.key).sort()).toEqual(["gemini", "minimax"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/aiProviderGate.test.ts`
Expected: FAIL — `getGate is not exported`

- [ ] **Step 3: Write minimal implementation**

Append to `lib/ai-tools/providers/gate.ts`:

```ts
/* ----------------------------------------------------------- the registry */

/**
 * Process-wide gates, one per provider key.
 *
 * Module-level state is the point: every AI call in the app must draw from the
 * SAME bucket per provider, whichever subsystem made it. A gate created per
 * request would enforce nothing.
 */
const gates = new Map<string, ProviderGate>();

/**
 * The gate for a provider, creating it on first use. An existing gate has its
 * budget UPDATED rather than being replaced — replacing it would discard the
 * in-flight count and the learned adaptive scale every time an operator saved
 * a settings change, which is exactly when accurate state matters most.
 */
export function getGate(providerKey: string, budget: RateBudget): ProviderGate {
  const existing = gates.get(providerKey);
  if (existing) {
    existing.setBudget(budget);
    return existing;
  }
  const created = new ProviderGate(providerKey, budget);
  gates.set(providerKey, created);
  return created;
}

/** Every live gate's state, for the admin screen. */
export function gateSnapshots(): GateSnapshot[] {
  return [...gates.values()].map((g) => g.snapshot());
}

/** Drop all gates. Tests only — production shares one process for its lifetime. */
export function resetGates(): void {
  gates.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/aiProviderGate.test.ts`
Expected: PASS — 26 tests

- [ ] **Step 5: Commit**

```bash
git add lib/ai-tools/providers/gate.ts tests/aiProviderGate.test.ts
git commit -m "feat(ai-tools): adaptive backoff and a process-wide gate registry"
```

---

### Task 6: Throw typed errors from the call seam

**Files:**
- Modify: `lib/ai-tools/run.ts:209-218`
- Test: `tests/aiProviderRetry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/aiProviderRetry.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callWithProvider, type ProviderSpec } from "@/lib/ai-tools/run";
import { ProviderHttpError } from "@/lib/ai-tools/providers/errors";
import { resetGates } from "@/lib/ai-tools/providers/gate";

const spec: ProviderSpec = {
  label: "Test Provider m1",
  endpoint: "https://api.example.com/v1/chat/completions",
  apiKey: "k",
  maxOutputTokens: 8000,
  providerKey: "testprov",
};

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

const okBody = {
  choices: [{ message: { content: "hello" } }],
  usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
};

describe("callWithProvider error typing", () => {
  beforeEach(() => resetGates());
  afterEach(() => vi.restoreAllMocks());

  it("throws ProviderHttpError carrying the status and Retry-After", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: { message: "rate limit exceeded" } }, { status: 429, headers: { "retry-after": "7" } }),
    );

    const err = await callWithProvider(spec, "m1", "sys", "user", { maxTokens: 100, temperature: 0, maxAttempts: 1 }).catch(
      (e) => e,
    );

    expect(err).toBeInstanceOf(ProviderHttpError);
    expect((err as ProviderHttpError).status).toBe(429);
    expect((err as ProviderHttpError).retryAfterMs).toBe(7000);
    expect((err as Error).message).toBe("rate limit exceeded");
  });

  it("captures x-ratelimit headers when the vendor sends them", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        { error: { message: "quota" } },
        { status: 429, headers: { "x-ratelimit-limit": "500", "x-ratelimit-remaining": "0" } },
      ),
    );

    const err = (await callWithProvider(spec, "m1", "s", "u", {
      maxTokens: 100,
      temperature: 0,
      maxAttempts: 1,
    }).catch((e) => e)) as ProviderHttpError;

    expect(err.rateLimit).toEqual({ limit: 500, remaining: 0 });
  });

  it("still succeeds normally", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(okBody));
    const out = await callWithProvider(spec, "m1", "s", "u", { maxTokens: 100, temperature: 0 });
    expect(out).toEqual({ text: "hello", tokens: 150 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/aiProviderRetry.test.ts`
Expected: FAIL — the thrown value is a plain `Error`, not a `ProviderHttpError`; and `maxAttempts`/`providerKey` are not valid properties.

- [ ] **Step 3: Write minimal implementation**

In `lib/ai-tools/run.ts`, add to the imports at the top of the file:

```ts
import { ProviderHttpError, parseRetryAfter, rateLimitHeadersFrom } from "@/lib/ai-tools/providers/errors";
```

Add two fields to `ProviderSpec` (after `outputTokenParam`):

```ts
  /**
   * Which rate-budget bucket this call draws from. Every provider pools its
   * quota across models and modalities, so this is the provider, never the
   * model. Absent falls back to the endpoint host, which is the same thing by
   * another name and keeps legacy env-configured tools working.
   */
  providerKey?: string;
  /** The budget in force for that bucket, resolved by the caller. */
  rateBudget?: RateBudget;
```

and add the type import:

```ts
import type { RateBudget } from "@/lib/ai-tools/providers/limits";
```

Add `maxAttempts` to `ProviderCallOptions`:

```ts
  /**
   * Attempts, inclusive of the first. Defaults to MAX_ATTEMPTS. Tests pin it
   * to 1 to assert single-shot behaviour without waiting out backoff.
   */
  maxAttempts?: number;
```

Replace the `if (!res.ok)` block (currently `lib/ai-tools/run.ts:209-218`):

```ts
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j?.error?.message || j?.message || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
```

with:

```ts
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j?.error?.message || j?.message || msg;
    } catch {
      /* ignore */
    }
    // The status is the whole point: a 429 is "wait, then this call would have
    // worked", a 400 is "this call can never work". Flattening both into
    // Error(msg) is what made rate limiting look like permanent failure.
    // The human-readable message is preserved verbatim so no existing error
    // surface regresses.
    throw new ProviderHttpError(msg, res.status, parseRetryAfter(res.headers.get("retry-after")), rateLimitHeadersFrom(res.headers));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/aiProviderRetry.test.ts -t "error typing"`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add lib/ai-tools/run.ts tests/aiProviderRetry.test.ts
git commit -m "fix(ai-tools): stop discarding the HTTP status on a failed provider call"
```

---

### Task 7: Retry with backoff

**Files:**
- Modify: `lib/ai-tools/run.ts` (`callWithProvider`)
- Test: `tests/aiProviderRetry.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/aiProviderRetry.test.ts`:

```ts
import { AiCallAborted } from "@/lib/ai-tools/abort";
import { backoffDelayMs, MAX_ATTEMPTS } from "@/lib/ai-tools/run";

describe("backoffDelayMs", () => {
  it("obeys the vendor's Retry-After over its own schedule", () => {
    const e = new ProviderHttpError("slow down", 429, 12_000, null);
    expect(backoffDelayMs(1, e, () => 0.5)).toBe(12_000);
  });

  it("clamps a pathological Retry-After", () => {
    const e = new ProviderHttpError("slow down", 429, 999_999, null);
    expect(backoffDelayMs(1, e, () => 0.5)).toBe(60_000);
  });

  it("grows exponentially with jitter when the vendor says nothing", () => {
    const e = new ProviderHttpError("boom", 503, null, null);
    expect(backoffDelayMs(1, e, () => 1)).toBe(1000);
    expect(backoffDelayMs(2, e, () => 1)).toBe(2000);
    expect(backoffDelayMs(3, e, () => 1)).toBe(4000);
    expect(backoffDelayMs(1, e, () => 0)).toBe(0);
  });

  it("caps the exponential schedule", () => {
    const e = new ProviderHttpError("boom", 503, null, null);
    expect(backoffDelayMs(20, e, () => 1)).toBe(30_000);
  });
});

describe("callWithProvider retry", () => {
  beforeEach(() => {
    resetGates();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries a 429 and succeeds", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ error: { message: "rate limited" } }, { status: 429, headers: { "retry-after": "1" } }))
      .mockResolvedValueOnce(jsonResponse(okBody));

    const promise = callWithProvider(spec, "m1", "s", "u", { maxTokens: 100, temperature: 0 });
    await vi.advanceTimersByTimeAsync(5000);
    await expect(promise).resolves.toEqual({ text: "hello", tokens: 150 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never retries a terminal request error", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ error: { message: "bad model" } }, { status: 400 }));

    const promise = callWithProvider(spec, "m1", "s", "u", { maxTokens: 100, temperature: 0 });
    await expect(promise).rejects.toThrow("bad model");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after the attempt budget and rethrows the last failure", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ error: { message: "still limited" } }, { status: 429 }));

    const promise = callWithProvider(spec, "m1", "s", "u", { maxTokens: 100, temperature: 0 });
    const settled = promise.catch((e) => e);
    await vi.advanceTimersByTimeAsync(300_000);
    const err = await settled;
    expect((err as ProviderHttpError).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it("never retries an operator abort", async () => {
    const ac = new AbortController();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      ac.abort();
      return Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    });

    const promise = callWithProvider(spec, "m1", "s", "u", { maxTokens: 100, temperature: 0, signal: ac.signal });
    await expect(promise).rejects.toBeInstanceOf(AiCallAborted);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/aiProviderRetry.test.ts -t "backoff"`
Expected: FAIL — `backoffDelayMs is not exported`

- [ ] **Step 3: Write minimal implementation**

In `lib/ai-tools/run.ts`, add imports:

```ts
import { isAbortedError } from "./abort";
import { isRetryableError } from "@/lib/ai-tools/providers/errors";
import { sleep } from "@/lib/ai-tools/providers/gate";
```

(`AiCallAborted` and `combineAbortSignals` are already imported from `./abort`; add `isAbortedError` to that existing import rather than duplicating it.)

Add above `callWithProvider`:

```ts
/** Attempts per call, inclusive of the first. Four means three retries, which
 *  clears a typical per-minute window without letting one wedged call hold a
 *  gate slot for minutes. */
export const MAX_ATTEMPTS = 4;
/** Ceiling on a vendor-supplied Retry-After. A vendor that asks for ten
 *  minutes must not be able to wedge a generation. */
export const RETRY_AFTER_CAP_MS = 60_000;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30_000;

/**
 * How long to wait before the next attempt.
 *
 * The vendor's own `Retry-After` wins whenever it sends one — it knows when the
 * window resets and we are guessing. Otherwise: exponential from 1s with FULL
 * jitter, which matters more than it looks. Every page of a site is retrying at
 * once; a fixed schedule would have them all wake together and re-throttle each
 * other indefinitely.
 *
 * `random` is injectable purely so the schedule is testable.
 */
export function backoffDelayMs(attempt: number, error: unknown, random: () => number = Math.random): number {
  if (error instanceof ProviderHttpError && error.retryAfterMs !== null) {
    return Math.min(error.retryAfterMs, RETRY_AFTER_CAP_MS);
  }
  const ceiling = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_CAP_MS);
  return Math.round(ceiling * random());
}
```

The existing exported `callWithProvider` (`lib/ai-tools/run.ts:159-223`, the
function whose body starts with the `if (opts.signal?.aborted)` guard) becomes a
private single-attempt helper. Two edits to it, nothing else:

**(a)** Change its declaration line from

```ts
export async function callWithProvider(
```

to

```ts
async function attemptCall(
```

and its return type from `Promise<{ text: string; tokens: number }>` to
`Promise<{ text: string; tokens: number; usage: TokenUsage | null }>`.

**(b)** Replace its last three lines — currently

```ts
  const j = await res.json();
  const text: string = j?.choices?.[0]?.message?.content ?? "";
  const tokens: number = j?.usage?.total_tokens ?? Math.ceil(text.length / 4);
  return { text, tokens };
```

with

```ts
  const j = await res.json();
  const text: string = j?.choices?.[0]?.message?.content ?? "";
  // The raw usage block, not just the total: the gate's TPM accounting learns
  // an output-to-input ratio from prompt/completion, which the total alone
  // cannot supply.
  const usage = (j?.usage ?? null) as TokenUsage | null;
  const tokens: number = usage?.total_tokens ?? Math.ceil(text.length / 4);
  return { text, tokens, usage };
```

Everything between those two edits — the abort guard, the multimodal
`userContent` assembly, the timeout controller, the `fetch`, the catch block,
and the `!res.ok` handling from Task 6 — is untouched.

Note: the catch block's timeout message already calls `callTimedOutMessage`
from `providers/errors.ts` (a Task 1 review fix). `isRetryableError` matches on
the `CALL_TIMEOUT_MARKER` that builder uses, so the two sides cannot drift.
Leave that line as it is.

Add the `TokenUsage` type import:

```ts
import type { TokenUsage } from "@/lib/ai-tools/providers/gate";
```

Then add the new exported `callWithProvider` wrapper below it:

```ts
/**
 * The actual OpenAI-compatible call, with retries. Identical wire format for
 * every provider we support, which is why adding a provider is a descriptor
 * and nothing else.
 *
 * A retryable failure (429, transient 5xx, timeout, network fault) is retried
 * with backoff; a terminal one (bad request, bad key) is thrown immediately
 * because retrying it cannot succeed and spends quota a concurrent run needs.
 * An operator abort is never retried.
 */
export async function callWithProvider(
  cfg: ProviderSpec,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  opts: ProviderCallOptions,
): Promise<{ text: string; tokens: number }> {
  const attempts = Math.max(1, opts.maxAttempts ?? MAX_ATTEMPTS);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const out = await attemptCall(cfg, model, systemPrompt, userPrompt, opts);
      return { text: out.text, tokens: out.tokens };
    } catch (e) {
      lastError = e;
      if (isAbortedError(e)) throw e;
      if (!isRetryableError(e) || attempt === attempts) throw e;
      await sleep(backoffDelayMs(attempt, e), opts.signal);
    }
  }
  throw lastError;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/aiProviderRetry.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 5: Commit**

```bash
git add lib/ai-tools/run.ts tests/aiProviderRetry.test.ts
git commit -m "feat(ai-tools): retry throttled and transient provider failures with jittered backoff"
```

---

### Task 8: Wire the gate into the call path

**Files:**
- Modify: `lib/ai-tools/run.ts` (`callWithProvider`)
- Test: `tests/aiProviderRetry.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/aiProviderRetry.test.ts`:

```ts
import { getGate } from "@/lib/ai-tools/providers/gate";

describe("callWithProvider gating", () => {
  beforeEach(() => {
    resetGates();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("never exceeds the provider's concurrency ceiling", async () => {
    let concurrent = 0;
    let peak = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise((r) => setTimeout(r, 100));
      concurrent -= 1;
      return jsonResponse(okBody);
    });

    const gated: ProviderSpec = { ...spec, rateBudget: { concurrency: 2 } };
    const calls = Array.from({ length: 6 }, () =>
      callWithProvider(gated, "m1", "s", "u", { maxTokens: 100, temperature: 0 }),
    );
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all(calls);

    expect(peak).toBeLessThanOrEqual(2);
  });

  it("halves the provider's scale after a 429", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: { message: "limited" } }, { status: 429 }));
    const gated: ProviderSpec = { ...spec, rateBudget: { concurrency: 4 } };

    await callWithProvider(gated, "m1", "s", "u", { maxTokens: 100, temperature: 0, maxAttempts: 1 }).catch(() => {});

    expect(getGate("testprov", {}).snapshot().scale).toBeLessThan(1);
  });

  it("releases its slot even when the call throws", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: { message: "nope" } }, { status: 400 }));
    const gated: ProviderSpec = { ...spec, rateBudget: { concurrency: 1 } };

    await callWithProvider(gated, "m1", "s", "u", { maxTokens: 100, temperature: 0 }).catch(() => {});

    expect(getGate("testprov", {}).snapshot().inFlight).toBe(0);
  });

  it("buckets by endpoint host when no provider key is given", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(okBody));
    const keyless: ProviderSpec = { label: "L", endpoint: "https://api.example.com/v1/x", apiKey: "k", maxOutputTokens: 100 };
    await callWithProvider(keyless, "m1", "s", "u", { maxTokens: 10, temperature: 0 });
    expect(getGate("api.example.com", {}).snapshot().requestsThisMinute).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/aiProviderRetry.test.ts -t "gating"`
Expected: FAIL — peak concurrency is 6, not 2 (nothing gates yet)

- [ ] **Step 3: Write minimal implementation**

In `lib/ai-tools/run.ts`, extend the gate import:

```ts
import { estimateInputTokens, getGate, sleep, type TokenUsage } from "@/lib/ai-tools/providers/gate";
```

Add above `callWithProvider`:

```ts
/**
 * Which rate bucket a spec draws from. The endpoint HOST is the fallback and
 * is not a compromise: two specs pointing at the same host really do share one
 * vendor quota, so bucketing by host is correct for every legacy caller that
 * predates `providerKey`.
 */
function gateKeyFor(cfg: ProviderSpec): string {
  if (cfg.providerKey) return cfg.providerKey;
  try {
    return new URL(cfg.endpoint).host;
  } catch {
    return cfg.endpoint;
  }
}
```

Replace the body of the exported `callWithProvider` from Task 7 with the gated version:

```ts
export async function callWithProvider(
  cfg: ProviderSpec,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  opts: ProviderCallOptions,
): Promise<{ text: string; tokens: number }> {
  const attempts = Math.max(1, opts.maxAttempts ?? MAX_ATTEMPTS);
  const gate = getGate(gateKeyFor(cfg), cfg.rateBudget ?? {});
  const inputTokens = estimateInputTokens(systemPrompt, userPrompt, opts.images?.length ?? 0);
  const maxTokens = Math.min(opts.maxTokens, cfg.maxOutputTokens);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    // Acquired per ATTEMPT, not per call: a retry is a fresh request against
    // the vendor's budget and must queue behind everything else rather than
    // riding in on a slot it reserved a minute ago.
    const slot = await gate.acquire({ inputTokens, model, maxTokens }, opts.signal);
    try {
      const out = await attemptCall(cfg, model, systemPrompt, userPrompt, opts);
      slot.settle(out.usage);
      return { text: out.text, tokens: out.tokens };
    } catch (e) {
      slot.settleError(e);
      lastError = e;
      if (isAbortedError(e)) throw e;
      if (!isRetryableError(e) || attempt === attempts) throw e;
      await sleep(backoffDelayMs(attempt, e), opts.signal);
    }
  }
  throw lastError;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/aiProviderRetry.test.ts`
Expected: PASS — 15 tests

- [ ] **Step 5: Verify nothing else regressed**

Run: `npx vitest run`
Expected: PASS — full suite green

- [ ] **Step 6: Commit**

```bash
git add lib/ai-tools/run.ts tests/aiProviderRetry.test.ts
git commit -m "feat(ai-tools): pace every provider call through its provider's rate gate"
```

---

### Task 9: Stop falling back to another provider on a rate limit

**Files:**
- Modify: `lib/ai-tools/providers/run.ts:86-109`
- Test: `tests/aiTaskRouting.test.ts` (append)

- [ ] **Step 1: Write the failing test**

This needs `callWithProvider` replaced, and `vi.spyOn` on an ESM named export is
not reliably interceptable — the importing module holds a live binding, not a
property lookup. Use a module mock, which is hoisted and therefore does apply.

Create a NEW file `tests/aiTaskFallback.test.ts` rather than appending, so the
module mock cannot leak into the existing routing tests:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProviderHttpError } from "@/lib/ai-tools/providers/errors";

/**
 * `callForTask` retries a failed call on the task's DEFAULT provider. That is
 * right for a configuration failure and wrong for a rate limit — see the
 * comment this file exists to protect, in providers/run.ts.
 */

const callWithProvider = vi.fn();
vi.mock("@/lib/ai-tools/run", () => ({ callWithProvider }));

// Minimal routing stub: an assigned provider that is NOT the task default, so
// a fallback would be observable as a second call with different arguments.
vi.mock("@/lib/ai-tools/providers/config", () => ({
  resolveTaskModel: vi.fn(async () => ({
    providerKey: "minimax",
    model: "MiniMax-M3",
    spec: { label: "MiniMax M3", endpoint: "https://api.minimax.io/v1/chat/completions", apiKey: "k", maxOutputTokens: 1000 },
    outputTokens: 1000,
    usedFallback: false,
    fallbackReason: null,
  })),
  defaultSpecForTask: vi.fn(async () => ({
    providerKey: "gemini",
    model: "gemini-3.1-pro-preview",
    spec: { label: "Gemini", endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", apiKey: "k", maxOutputTokens: 1000 },
    outputTokens: 1000,
    usedFallback: true,
    fallbackReason: null,
  })),
}));

describe("callForTask fallback", () => {
  beforeEach(async () => {
    callWithProvider.mockReset();
    const { clearTaskModelCache } = await import("@/lib/ai-tools/providers/run");
    clearTaskModelCache();
  });

  it("throws a 429 straight through instead of rerouting to another model", async () => {
    const { callForTask } = await import("@/lib/ai-tools/providers/run");
    callWithProvider.mockRejectedValue(new ProviderHttpError("rate limited", 429, null, null));

    await expect(callForTask("site_build", "s", "u", { maxTokens: 100, temperature: 0 })).rejects.toBeInstanceOf(
      ProviderHttpError,
    );
    expect(callWithProvider).toHaveBeenCalledTimes(1);
  });

  it("throws a transient 503 through too — its retries already happened downstream", async () => {
    const { callForTask } = await import("@/lib/ai-tools/providers/run");
    callWithProvider.mockRejectedValue(new ProviderHttpError("upstream down", 503, null, null));

    await expect(callForTask("site_build", "s", "u", { maxTokens: 100, temperature: 0 })).rejects.toBeInstanceOf(
      ProviderHttpError,
    );
    expect(callWithProvider).toHaveBeenCalledTimes(1);
  });

  it("still falls back when the assigned model is misconfigured", async () => {
    const { callForTask } = await import("@/lib/ai-tools/providers/run");
    callWithProvider
      .mockRejectedValueOnce(new ProviderHttpError("model not found", 404, null, null))
      .mockResolvedValueOnce({ text: "ok", tokens: 1 });

    const out = await callForTask("site_build", "s", "u", { maxTokens: 100, temperature: 0 });
    expect(out.text).toBe("ok");
    expect(out.providerKey).toBe("gemini");
    expect(callWithProvider).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/aiTaskFallback.test.ts`
Expected: FAIL — the 429 and 503 cases each call `callWithProvider` twice; the fallback fired

- [ ] **Step 3: Write minimal implementation**

In `lib/ai-tools/providers/run.ts`, add the import:

```ts
import { isRetryableError } from "./errors";
```

and replace the abort guard inside the `catch` block (currently
`lib/ai-tools/providers/run.ts:88-90`):

```ts
    if (isAbortedError(e)) throw e;
```

with:

```ts
    if (isAbortedError(e)) throw e;
    // A RETRYABLE failure has already had its full retry budget inside
    // callWithProvider. Falling back now would move the operator's chosen model
    // onto a different one because the first was momentarily busy — silently
    // changing which model wrote a customer's site, with nothing in the run to
    // say it happened. Fallback exists for CONFIGURATION failures (bad key,
    // disabled provider, retired model), which are terminal, and those still
    // fall through to the block below.
    if (isRetryableError(e)) throw e;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/aiTaskFallback.test.ts tests/aiTaskRouting.test.ts`
Expected: PASS — 3 new tests, plus the existing routing suite unchanged

- [ ] **Step 5: Commit**

```bash
git add lib/ai-tools/providers/run.ts tests/aiTaskFallback.test.ts
git commit -m "fix(ai-tools): a busy provider must not silently reroute a page to another model"
```

---

### Task 10: Persist operator rate limits

**Files:**
- Create: `supabase/migrations/0062_ai_provider_rate_limits.sql`
- Modify: `lib/ai-tools/providers/config.ts`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0062_ai_provider_rate_limits.sql`:

```sql
-- 0062_ai_provider_rate_limits.sql — operator-set rate budget per AI provider.
--
-- ADDITIVE ONLY. Shared prod DB: one nullable column, no drops, no type
-- changes, no edits to existing columns or data.
--
-- WHY. Site Builder generations began returning HTTP 429 after roughly the
-- fifth run: every page of a site was dispatched simultaneously with nothing
-- pacing them. The gate that now paces them (lib/ai-tools/providers/gate.ts)
-- needs to know each provider's ceiling, and those ceilings are per ACCOUNT
-- TIER, not per vendor — Kimi alone spans 1 to 1000 concurrent requests across
-- its published tiers. Hardcoding one number per vendor would be wrong for
-- every operator but one.
--
-- SHAPE: {"concurrency": 100, "rpm": 500, "tpm": 3000000, "tpd": null}
-- A key ABSENT means "use the shipped default"; a key present with null means
-- "this vendor does not limit that dimension, stop enforcing it". Those are
-- different intents and the settings UI offers both, so they cannot share one
-- representation. Validation lives in resolveBudget()
-- (lib/ai-tools/providers/limits.ts), which ignores anything unusable rather
-- than letting a typo throttle generation to nothing — so this column needs no
-- check constraint beyond being an object.
--
-- NULL is the default for every existing row, meaning "shipped defaults only",
-- so applying this changes no behaviour.
alter table public.ai_providers
  add column if not exists rate_limits jsonb
    check (rate_limits is null or jsonb_typeof(rate_limits) = 'object');
```

- [ ] **Step 2: Write the failing test**

Append to `tests/aiTaskRouting.test.ts`:

```ts
describe("provider rate limits", () => {
  beforeEach(() => {
    tables.ai_providers = [];
    tables.ai_task_assignments = [];
  });

  it("carries a stored budget into the resolved spec", async () => {
    const { saveAiProvider, resolveTaskModel } = await import("@/lib/ai-tools/providers/config");
    const { clearTaskModelCache } = await import("@/lib/ai-tools/providers/run");

    await saveAiProvider("minimax", { enabled: true, credentials: { api_key: "k" }, rateLimits: { rpm: 30 } });
    clearTaskModelCache();

    const resolved = await resolveTaskModel("image_rank");
    expect(resolved.providerKey).toBe("minimax");
    expect(resolved.spec.providerKey).toBe("minimax");
    expect(resolved.spec.rateBudget?.rpm).toBe(30);
  });

  it("survives a database that has not been migrated yet", async () => {
    // Simulates the pre-0062 shape: no rate_limits column at all.
    tables.ai_providers = [
      { provider_key: "minimax", enabled: true, encrypted_credentials: `enc:${Buffer.from(JSON.stringify({ api_key: "k" })).toString("base64")}`, updated_at: null },
    ];
    const { getAiProviderConfigs } = await import("@/lib/ai-tools/providers/config");
    const configs = await getAiProviderConfigs();
    expect(configs.find((c) => c.key === "minimax")?.configured ?? true).toBeTruthy();
    expect(configs.find((c) => c.key === "minimax")?.rateLimits ?? null).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/aiTaskRouting.test.ts -t "provider rate limits"`
Expected: FAIL — `rateLimits` is not a property of `SaveAiProviderInput`

- [ ] **Step 4: Write the implementation**

In `lib/ai-tools/providers/config.ts`:

**(a)** Add the import:

```ts
import { resolveBudget, type RateBudgetOverride } from "./limits";
```

**(b)** Add `rate_limits` to `ProviderRow`:

```ts
type ProviderRow = {
  provider_key: string;
  enabled: boolean;
  encrypted_credentials: string | null;
  /** Optional: absent until 0062 is applied — see `readProviderRows`. */
  rate_limits?: RateBudgetOverride | null;
  updated_at: string | null;
};
```

**(c)** Replace `readProviderRows` entirely. This is the most important edit in
the task:

```ts
async function readProviderRows(): Promise<ProviderRow[]> {
  try {
    const admin = createAdminClient();
    // `*` ON PURPOSE, not a column list — the same hazard `readAssignmentRows`
    // already documents, and here it is worse. A column list breaks the moment
    // the code knows about a column the DB has not been migrated to yet: the
    // query errors, the catch below swallows it, and EVERY provider reads as
    // unconfigured — taking ALL AI routing down until the migration lands.
    // With `*`, a column the DB lacks simply reads as undefined.
    const { data } = await admin.from(PROVIDER_TABLE).select("*");
    return (data ?? []) as ProviderRow[];
  } catch {
    return [];
  }
}
```

**(d)** Add `rateLimits` to `AiProviderConfigEntry`:

```ts
export interface AiProviderConfigEntry {
  key: string;
  enabled: boolean;
  /** Decrypted. NEVER serialise this into an HTTP response. */
  credentials: Record<string, string> | null;
  /** Operator's stored rate budget, or null for the shipped defaults. Holds no
   *  secret, so unlike `credentials` this is safe to project to a client. */
  rateLimits: RateBudgetOverride | null;
}
```

and populate it in `getAiProviderConfigs`:

```ts
    .map((r) => ({
      key: r.provider_key,
      enabled: r.enabled !== false,
      credentials: decodeCredentials(r.encrypted_credentials),
      rateLimits: (r.rate_limits ?? null) as RateBudgetOverride | null,
    }));
```

**(e)** Add `rateLimits` to `AiProviderStatus` and populate it in
`getAiProviderStatuses`:

```ts
export interface AiProviderStatus {
  key: string;
  enabled: boolean;
  configured: boolean;
  hint: string | null;
  rateLimits: RateBudgetOverride | null;
  updatedAt: string | null;
}
```

```ts
    return {
      key: d.key,
      enabled: row ? row.enabled !== false : false,
      configured: hasCompleteCredentials(d, creds),
      hint: maskCredentialHint(d, creds),
      rateLimits: (row?.rate_limits ?? null) as RateBudgetOverride | null,
      updatedAt: row?.updated_at ?? null,
    };
```

**(f)** Accept and persist it in `saveAiProvider`. Add to `SaveAiProviderInput`:

```ts
  /** Omit to keep what is stored; null resets to the shipped defaults. */
  rateLimits?: RateBudgetOverride | null;
```

and in the body, after the `encrypted` block:

```ts
  const rateLimits =
    input.rateLimits === undefined ? (row?.rate_limits ?? null) : input.rateLimits;
```

then add `rate_limits: rateLimits,` to the `patch` object and
`rateLimits,` to the returned status object.

**(g)** Populate the two new spec fields in `specFor`:

```ts
  return {
    spec: {
      label: `${descriptor.label} ${model.id}`,
      endpoint: descriptor.endpoint,
      apiKey,
      maxOutputTokens: model.maxOutputTokens,
      outputTokenParam: descriptor.outputTokenParam,
      providerKey: descriptor.key,
      rateBudget: resolveBudget(descriptor.key, config?.rateLimits ?? null),
    },
    outputTokens: clampOutputTokens(model, overrideTokens),
    reason: null,
  };
```

**(h)** Do the same in both env-key last-resort branches — in
`resolveTaskModel` and in `defaultSpecForTask`, add to each inline `spec`
object:

```ts
        providerKey: descriptor.key,
        rateBudget: resolveBudget(descriptor.key, null),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/aiTaskRouting.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0062_ai_provider_rate_limits.sql lib/ai-tools/providers/config.ts tests/aiTaskRouting.test.ts
git commit -m "feat(ai-tools): store a per-provider rate budget, and stop select-listing provider columns"
```

---

### Task 11: Expose budget and gate state to the admin surface

**Files:**
- Modify: `lib/ai-tools/providers/adminView.ts`
- Modify: `app/api/admin/ai-providers/route.ts`

- [ ] **Step 1: Extend the admin view**

In `lib/ai-tools/providers/adminView.ts`, add imports:

```ts
import { DEFAULT_RATE_BUDGETS, resolveBudget, type RateBudget, type RateBudgetOverride } from "./limits";
import { gateSnapshots, type GateSnapshot } from "./gate";
```

Add to `AiProviderSetting`:

```ts
  /** The shipped default budget for this provider — shown as placeholder text
   *  so the operator can see what they are overriding. */
  defaultRateBudget: RateBudget;
  /** The operator's stored override, or null when they have set none. */
  rateLimits: RateBudgetOverride | null;
  /** The budget actually in force right now. */
  effectiveRateBudget: RateBudget;
  /** Live gate state, or null when this provider has not been called yet this
   *  process. An adaptive limiter the operator cannot observe is a black box
   *  the moment it misbehaves. */
  gate: GateSnapshot | null;
```

and populate them in the `providers` map inside `listAiRoutingSettings`:

```ts
  const gatesByKey = new Map(gateSnapshots().map((g) => [g.key, g]));

  const providers: AiProviderSetting[] = AI_PROVIDER_REGISTRY.map((d) => {
    const s = statusByKey.get(d.key);
    const rateLimits = s?.rateLimits ?? null;
    return {
      key: d.key,
      label: d.label,
      endpoint: d.endpoint,
      docsUrl: d.docsUrl,
      credentialFields: d.credentialFields,
      models: d.models,
      capabilities: d.capabilities,
      enabled: s?.enabled ?? false,
      configured: s?.configured ?? false,
      hint: s?.hint ?? null,
      defaultRateBudget: DEFAULT_RATE_BUDGETS[d.key] ?? {},
      rateLimits,
      effectiveRateBudget: resolveBudget(d.key, rateLimits),
      gate: gatesByKey.get(d.key) ?? null,
      updatedAt: s?.updatedAt ?? null,
    };
  });
```

- [ ] **Step 2: Accept the payload in the API**

In `app/api/admin/ai-providers/route.ts`, extend `providerSchema`:

```ts
/** One rate-limit dimension: a positive integer, or explicit null meaning
 *  "this vendor does not limit that dimension". Absent means "leave it alone".
 *  Not range-checked beyond positivity — vendor ceilings span 1 to 1,000,000+
 *  across tiers, so any bound this schema invented would be wrong for someone.
 *  `resolveBudget` ignores anything unusable at read time regardless. */
const dimension = z.number().int().positive().nullable();

const providerSchema = z.object({
  kind: z.literal("provider"),
  provider_key: z.string().trim().min(1).max(64),
  enabled: z.boolean().optional(),
  /** Omit to keep what is stored; null clears it. */
  credentials: z.record(z.string(), z.string().max(500)).nullish(),
  /** Omit to keep what is stored; null resets to the shipped defaults. */
  rate_limits: z
    .object({
      concurrency: dimension.optional(),
      rpm: dimension.optional(),
      tpm: dimension.optional(),
      tpd: dimension.optional(),
    })
    .nullish(),
});
```

and pass it through in the provider branch of `PUT`:

```ts
      const provider = await saveAiProvider(parsed.data.provider_key, {
        enabled: parsed.data.enabled,
        credentials,
        rateLimits: parsed.data.rate_limits,
        updatedBy: auth.userId,
      });
```

- [ ] **Step 3: Verify the app compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Verify the suite still passes**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/ai-tools/providers/adminView.ts app/api/admin/ai-providers/route.ts
git commit -m "feat(ai-tools): surface rate budgets and live gate state to the admin API"
```

---

### Task 12: The operator's rate-limit form

**Files:**
- Modify: `components/ai-models/AiModelManager.tsx`

- [ ] **Step 1: Add the form component**

In `components/ai-models/AiModelManager.tsx`, add `Gauge` to the existing
`lucide-react` import, then add this component immediately above the
`/* -------------------------------------------------------------- provider */`
comment:

```tsx
/* ------------------------------------------------------------ rate limits */

const DIMENSIONS = [
  { key: "concurrency" as const, label: "Concurrent", hint: "Requests in flight at once" },
  { key: "rpm" as const, label: "Requests / min", hint: "RPM" },
  { key: "tpm" as const, label: "Tokens / min", hint: "TPM, input + output" },
  { key: "tpd" as const, label: "Tokens / day", hint: "TPD, blank if unlimited" },
];

function RateLimitForm({ provider, onPatch }: { provider: AiProviderSetting; onPatch: (next: Partial<AiProviderSetting>) => void }) {
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(DIMENSIONS.map((d) => [d.key, provider.rateLimits?.[d.key] != null ? String(provider.rateLimits[d.key]) : ""])),
  );
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      // Blank means "use the shipped default" — send the key omitted, not null,
      // since null carries the distinct meaning "this vendor does not limit
      // that dimension" (see limits.ts's RateBudgetOverride).
      const rate_limits: Record<string, number> = {};
      for (const d of DIMENSIONS) {
        const raw = (values[d.key] ?? "").trim();
        if (!raw) continue;
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) rate_limits[d.key] = Math.floor(n);
      }
      const res = await fetch(API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "provider", provider_key: provider.key, rate_limits }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: "Could not save limits", body: typeof data.error === "string" ? data.error : undefined });
        return;
      }
      onPatch({ rateLimits: rate_limits, effectiveRateBudget: { ...provider.defaultRateBudget, ...rate_limits } });
      toast({ kind: "success", title: `${provider.label} limits saved` });
    } finally {
      setSaving(false);
    }
  }

  const gate = provider.gate;

  return (
    <form onSubmit={save} className="rounded-md border border-border-subtle bg-surface-2 p-3">
      <div className="flex items-center gap-2">
        <Gauge className="h-4 w-4 shrink-0 text-text-faint" aria-hidden />
        <span className="text-xs font-medium text-text">Rate limits</span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-text-muted">
        Your account tier&apos;s ceilings. Leave a box blank to use our conservative default, shown greyed. Every AI call in the app
        shares one budget per provider, so a blank box is not &ldquo;unlimited&rdquo; — it is &ldquo;we&apos;ll guess low&rdquo;.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {DIMENSIONS.map((d) => (
          <label key={d.key} className="block">
            <span className="text-[11px] text-text-muted" title={d.hint}>
              {d.label}
            </span>
            <input
              type="number"
              min={1}
              inputMode="numeric"
              value={values[d.key] ?? ""}
              placeholder={provider.defaultRateBudget[d.key] != null ? String(provider.defaultRateBudget[d.key]) : "none"}
              onChange={(e) => setValues((v) => ({ ...v, [d.key]: e.target.value }))}
              className="tabular mt-1 w-full rounded border border-border bg-surface px-2 py-1 font-mono text-[11px] text-text"
            />
          </label>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving} className={btnSecondarySm}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save limits
        </button>
        {gate ? (
          <span className="tabular font-mono text-[11px] text-text-faint">
            {gate.inFlight} in flight · {gate.requestsThisMinute}/min · pacing at {Math.round(gate.scale * 100)}%
            {gate.throttlesLastHour > 0 ? ` · ${gate.throttlesLastHour} throttled in the last hour` : ""}
          </span>
        ) : (
          <span className="text-[11px] text-text-faint">No calls yet this session.</span>
        )}
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Render it inside the provider card**

In `ProviderCard`, replace the credential row (currently the `lg:col-span-2`
div wrapping `CredentialForm`) with:

```tsx
        <div className="lg:col-span-2">
          <RateLimitForm provider={provider} onPatch={(next) => onPatch(provider.key, next)} />
        </div>

        <div className="lg:col-span-2">
          <CredentialForm provider={provider} onPatch={(next) => onPatch(provider.key, next)} />
        </div>
```

- [ ] **Step 3: Verify it compiles and lints**

Run: `npx tsc --noEmit && npx eslint components/ai-models/AiModelManager.tsx`
Expected: no errors

- [ ] **Step 4: Verify in the browser**

Start the dev server via the preview tooling, open `/admin/ai-models`, and
confirm: each provider card shows four limit boxes with greyed defaults as
placeholders; entering `100 / 500 / 3000000` for Kimi and saving shows a
success toast; reloading the page keeps the values.

- [ ] **Step 5: Commit**

```bash
git add components/ai-models/AiModelManager.tsx
git commit -m "feat(ai-models): let an operator set each provider's tier limits and watch the gate"
```

---

### Task 13: Give a paced generation room to finish

**Files:**
- Modify: `app/api/site-builder/runs/[id]/generate/route.ts:10`

- [ ] **Step 1: Raise the ceiling**

Replace line 10 of `app/api/site-builder/runs/[id]/generate/route.ts`:

```ts
export const maxDuration = 300;
```

with:

```ts
/**
 * Generation is now PACED behind each provider's rate budget (see
 * lib/ai-tools/providers/gate.ts), so a site's pages no longer all dispatch at
 * once — they queue, and a throttled call additionally waits out its backoff.
 * A seven-call run against a low per-minute ceiling comfortably exceeds five
 * minutes, and the old 300s ceiling would have killed it mid-flight, leaving a
 * "generating" row nothing could recover.
 *
 * Self-hosted `next start` does not enforce this the way a serverless platform
 * does; it is raised anyway so the intent is explicit rather than incidental.
 * The run screen polls per-page progress throughout (see the `persist` chain
 * below), so a long run stays observable rather than looking hung.
 */
export const maxDuration = 3600;
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: PASS — every test green

- [ ] **Step 4: Commit**

```bash
git add "app/api/site-builder/runs/[id]/generate/route.ts"
git commit -m "fix(site-builder): give a rate-paced generation room to finish"
```

---

## Verification

After Task 13, confirm the whole subsystem end to end:

- [ ] `npx vitest run` — full suite green
- [ ] `npx tsc --noEmit` — no type errors
- [ ] `npx eslint` — clean
- [ ] Apply migration `0062` to the dev database, open `/admin/ai-models`, set MiniMax to `rpm: 60` and Kimi to its Tier2 figures (`concurrency: 100`, `rpm: 500`, `tpm: 3000000`), and confirm the values persist across a reload.
- [ ] Run a real multi-page Site Builder generation against MiniMax. Confirm in the server log that no `[ai-gate]` 429 warning appears, that the run reaches `review`, and that the per-page progress on the run screen advances steadily rather than all at once.
- [ ] Deliberately set MiniMax `rpm: 1` and start a generation. Confirm pages complete slowly and sequentially, and that the run still finishes rather than failing — this is the proof that pacing replaced failure.
