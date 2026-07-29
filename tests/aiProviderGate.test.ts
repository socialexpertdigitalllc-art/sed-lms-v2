// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CHARS_PER_TOKEN,
  IMAGE_TOKEN_ESTIMATE,
  SEED_OUTPUT_RATIO,
  OUTPUT_SAMPLE_SIZE,
  MIN_OUTPUT_SAMPLES,
  estimateInputTokens,
  outputRatioFrom,
  OutputRatioEstimator,
  ProviderGate,
  sleep,
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
    for (let i = 0; i < MIN_OUTPUT_SAMPLES - 1; i++) est.record("minimax:MiniMax-M3", 0.2);
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
    for (let i = 0; i < 3; i++) est.record("k", 0.9);
    for (let i = 0; i < OUTPUT_SAMPLE_SIZE; i++) est.record("k", 0.1);
    expect(est.ratio("k")).toBeCloseTo(0.1, 5);
  });

  it("ignores non-finite and negative samples", () => {
    const est = new OutputRatioEstimator();
    est.record("k", NaN);
    est.record("k", -1);
    est.record("k", Infinity);
    expect(est.ratio("k")).toBe(SEED_OUTPUT_RATIO);
  });
});

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

  // A caller that settles in both a `try` and a `finally` — or settles and then
  // reports the error — must not free a slot it never held, or the ceiling
  // silently stops being a ceiling. Guards the `settled` flag in `commit`.
  it("settles at most once however many times a caller calls it", async () => {
    const gate = new ProviderGate("p", { concurrency: 2, tpm: 100_000 });
    const held = await gate.acquire({ inputTokens: 10, model: "m", maxTokens: 10 });
    const slot = await gate.acquire({ inputTokens: 10_000, model: "m", maxTokens: 50_000 });
    expect(gate.snapshot().inFlight).toBe(2);

    slot.settle({ prompt_tokens: 10_000, completion_tokens: 1_000, total_tokens: 11_000 });
    slot.settle({ prompt_tokens: 10_000, completion_tokens: 1_000, total_tokens: 11_000 });
    slot.settleError(new Error("boom"));

    // One release only: the other call is still in flight.
    expect(gate.snapshot().inFlight).toBe(1);
    // And the ledger reconciled once, not repeatedly: the settled call's real
    // 11_000, plus the still-open call's reservation (10 input + an output
    // estimate capped at its own maxTokens of 10).
    expect(gate.snapshot().tokensThisMinute).toBe(11_000 + 20);
    held.settle(null);
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
