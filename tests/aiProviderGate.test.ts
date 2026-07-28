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
