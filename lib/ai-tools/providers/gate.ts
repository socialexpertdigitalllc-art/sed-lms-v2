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
