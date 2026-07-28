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
  // Tier1 figures. Gemini's documented daily ceiling is RPD (requests/day),
  // which `tpd` (tokens/day) cannot represent — deliberately left undeclared
  // rather than mapped onto the wrong unit. Do not set gemini.tpd expecting
  // it to capture that limit; it would enforce a token quota the vendor never
  // published instead of the request quota the vendor did.
  gemini: { rpm: 150, tpm: 1_000_000 },
};

/** The lower bound on the adaptive layer's multiplicative decay — each backoff
 *  multiplies the scale by a fraction, and without a floor repeated backoffs
 *  would decay toward zero. This bounds that decay away from zero; it is
 *  `scaleBudget`'s own `Math.max(1, ...)` floors below that keep a scaled
 *  budget's dimensions from reaching zero. */
export const MIN_SCALE = 0.05;

const DIMENSIONS = ["concurrency", "rpm", "tpm", "tpd"] as const;

/**
 * The budget actually in force for a provider: the shipped default, with any
 * operator override applied on top. Anything unusable in the override (zero,
 * fractional, negative, NaN) is ignored in favour of the default rather than
 * accepted — a typo in a settings field must not silently throttle generation
 * to nothing. This matters most for `tpd`: `scaleBudget` never touches it and
 * the gate has no floor on it, so an override that collapsed to 0 here would
 * wedge a provider until the next day boundary.
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
    if (typeof value === "number" && Number.isFinite(value) && value >= 1) out[key] = Math.floor(value);
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
  const s = Number.isFinite(scale) ? Math.min(1, Math.max(MIN_SCALE, scale)) : MIN_SCALE;
  // Start from a full copy so any dimension this function doesn't know about
  // (a future `rpd`, say) passes through unscaled instead of being silently
  // dropped. Only the per-minute fields below are overwritten; `tpd` is left
  // as copied — see the function doc for why a daily quota is never scaled.
  const out: RateBudget = { ...budget };
  if (budget.concurrency !== undefined) out.concurrency = Math.max(1, Math.floor(budget.concurrency * s));
  if (budget.rpm !== undefined) out.rpm = Math.max(1, Math.floor(budget.rpm * s));
  if (budget.tpm !== undefined) out.tpm = Math.max(1, Math.floor(budget.tpm * s));
  return out;
}
