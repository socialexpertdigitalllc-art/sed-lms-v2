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
  GateTimeoutError,
  sleep,
  RAMP_QUIET_MS,
  RAMP_STEP,
  THROTTLE_COOLDOWN_MS,
  GATE_SLOW_WAIT_WARN_MS,
  getGate,
  gateSnapshots,
  resetGates,
} from "@/lib/ai-tools/providers/gate";
import { isRetryableError, ProviderHttpError } from "@/lib/ai-tools/providers/errors";
import { scaleBudget } from "@/lib/ai-tools/providers/limits";

/** A 429 as the provider layer reports it. */
const throttled = () => new ProviderHttpError("rate limited", 429, null, null);

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

describe("ProviderGate adaptive pacing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Drive one 429 through the gate, `gap` ms after the previous one. */
  const throttleOnce = async (gate: ProviderGate, gap = 0) => {
    if (gap) vi.advanceTimersByTime(gap);
    const slot = await gate.acquire({ inputTokens: 10, model: "m", maxTokens: 10 });
    slot.settleError(throttled());
  };

  it("treats a burst of 429s as ONE congestion event", async () => {
    const gate = new ProviderGate("minimax", { rpm: 60 });
    // Four calls hit the same wall milliseconds apart, as concurrent pages do.
    for (let i = 0; i < 4; i++) await throttleOnce(gate, 100);
    // Halved once, not four times: rpm 30, not the rpm 3 this used to give.
    expect(gate.snapshot().scale).toBe(0.5);
    expect(scaleBudget({ rpm: 60 }, gate.snapshot().scale).rpm).toBe(30);
    // But all four are still counted as health signal.
    expect(gate.snapshot().throttlesLastHour).toBe(4);
  });

  it("does not re-halve for a 429 the caller declares part of one event", async () => {
    const gate = new ProviderGate("minimax", { rpm: 60 });
    await throttleOnce(gate);
    expect(gate.snapshot().scale).toBe(0.5);

    // FAR outside the cooldown — a retry whose vendor asked for a long wait —
    // so proximity alone would read this as a separate wall and halve again.
    // The caller knows better and says so.
    vi.advanceTimersByTime(THROTTLE_COOLDOWN_MS * 4);
    const slot = await gate.acquire({ inputTokens: 10, model: "m", maxTokens: 10 });
    slot.settleError(throttled(), { sameCongestionEvent: true });

    expect(gate.snapshot().scale).toBe(0.5);
    // Recorded regardless: it is a real 429 and the operator must see it.
    expect(gate.snapshot().throttlesLastHour).toBe(2);
  });

  it("backs off again for a genuinely separate congestion event", async () => {
    const gate = new ProviderGate("minimax", { rpm: 60 });
    await throttleOnce(gate);
    expect(gate.snapshot().scale).toBe(0.5);
    // Past the cooldown, but before the quiet period would ramp anything back.
    await throttleOnce(gate, THROTTLE_COOLDOWN_MS + 1);
    expect(gate.snapshot().scale).toBe(0.25);
  });

  it("keeps the burst window rolling so a steady stream is not re-halved", async () => {
    const gate = new ProviderGate("p", { rpm: 60 });
    await throttleOnce(gate);
    // Five 429s, each inside the cooldown relative to the one before it but
    // spanning longer than the cooldown in total: still one event.
    for (let i = 0; i < 5; i++) await throttleOnce(gate, THROTTLE_COOLDOWN_MS - 500);
    expect(gate.snapshot().scale).toBe(0.5);
  });

  it("recovers on elapsed quiet time alone, with no traffic at all", async () => {
    const gate = new ProviderGate("minimax", { rpm: 60 });
    await throttleOnce(gate);
    expect(gate.snapshot().scale).toBe(0.5);

    // Not a single further call — the next run has not started yet.
    vi.advanceTimersByTime(RAMP_QUIET_MS);
    expect(gate.snapshot().scale).toBeCloseTo(0.5 + RAMP_STEP, 5);

    // Multiple quiet periods bank multiple steps rather than only one.
    vi.advanceTimersByTime(RAMP_QUIET_MS * 3);
    expect(gate.snapshot().scale).toBeCloseTo(0.5 + RAMP_STEP * 4, 5);
  });

  it("ramps back to exactly 1 and stops there", async () => {
    const gate = new ProviderGate("p", { rpm: 60 });
    await throttleOnce(gate);
    vi.advanceTimersByTime(RAMP_QUIET_MS * 50);
    expect(gate.snapshot().scale).toBe(1);
    expect(scaleBudget({ rpm: 60 }, gate.snapshot().scale).rpm).toBe(60);
  });

  it("counts quiet time from the last 429 of a burst, not the first", async () => {
    const gate = new ProviderGate("p", { rpm: 60 });
    await throttleOnce(gate);
    await throttleOnce(gate, 3000); // duplicate report, 3s into the event
    // 59s after the FIRST 429 but only 56s after the last: no ramp yet.
    vi.advanceTimersByTime(RAMP_QUIET_MS - 4000);
    expect(gate.snapshot().scale).toBe(0.5);
    vi.advanceTimersByTime(5000);
    expect(gate.snapshot().scale).toBeCloseTo(0.5 + RAMP_STEP, 5);
  });

  it("clears pacing learned against an old budget when the operator changes it", async () => {
    const gate = new ProviderGate("minimax", { rpm: 60, tpm: 500_000 });
    for (let i = 0; i < 4; i++) await throttleOnce(gate, 100);
    expect(gate.snapshot().scale).toBe(0.5);

    gate.setBudget({ rpm: 600, tpm: 500_000 });
    expect(gate.snapshot().scale).toBe(1);
    expect(scaleBudget({ rpm: 600 }, gate.snapshot().scale).rpm).toBe(600);
    // The health signal is not pacing state and must survive the change.
    expect(gate.snapshot().throttlesLastHour).toBe(4);
  });

  it("keeps its learned pacing when handed an equal budget", async () => {
    // The registry re-applies a freshly built but equal budget on every lookup;
    // resetting on that would disable adaptation entirely.
    const gate = new ProviderGate("minimax", { rpm: 60, tpm: 500_000 });
    await throttleOnce(gate);
    expect(gate.snapshot().scale).toBe(0.5);
    gate.setBudget({ rpm: 60, tpm: 500_000 });
    expect(gate.snapshot().scale).toBe(0.5);
  });

  it("notices a dimension being cleared, not just changed", async () => {
    const gate = new ProviderGate("p", { rpm: 60, tpm: 500_000 });
    await throttleOnce(gate);
    gate.setBudget({ rpm: 60 }); // tpm dropped: undefined vs a number
    expect(gate.snapshot().scale).toBe(1);
  });
});

describe("ProviderGate wait deadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("gives up rather than parking a caller for a day on a TPD block", async () => {
    const gate = new ProviderGate("kimi", { tpd: 1000 });
    const first = await gate.acquire({ inputTokens: 900, model: "m", maxTokens: 10 });

    const blocked = gate.acquire({ inputTokens: 900, model: "m", maxTokens: 10 }, undefined, 5000);
    const assertion = expect(blocked).rejects.toBeInstanceOf(GateTimeoutError);
    await vi.advanceTimersByTimeAsync(6000);
    await assertion;
    first.settle(null);
  });

  it("names the provider and the blocking dimension, and reads as retryable", async () => {
    const gate = new ProviderGate("deepseek", { concurrency: 1 });
    const held = await gate.acquire({ inputTokens: 10, model: "m", maxTokens: 10 });

    const blocked = gate.acquire({ inputTokens: 10, model: "m", maxTokens: 10 }, undefined, 2000).catch((e) => e);
    await vi.advanceTimersByTimeAsync(3000);
    const err = (await blocked) as GateTimeoutError;

    expect(err).toBeInstanceOf(GateTimeoutError);
    expect(err.providerKey).toBe("deepseek");
    expect(err.dimension).toBe("concurrency");
    // errors.ts must classify it as worth retrying, without errors.ts knowing
    // this class exists.
    expect(isRetryableError(err)).toBe(true);
    held.settle(null);
  });

  it("waits indefinitely when no deadline is given", async () => {
    const gate = new ProviderGate("p", { concurrency: 1 });
    const held = await gate.acquire({ inputTokens: 10, model: "m", maxTokens: 10 });
    let acquired = false;
    const second = gate.acquire({ inputTokens: 10, model: "m", maxTokens: 10 }).then((s) => {
      acquired = true;
      return s;
    });

    await vi.advanceTimersByTimeAsync(120_000);
    expect(acquired).toBe(false);
    held.settle(null);
    await vi.advanceTimersByTimeAsync(200);
    expect(acquired).toBe(true);
    (await second).settle(null);
  });

  it("warns once — not once per poll — when a caller is parked a long time", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const gate = new ProviderGate("minimax", { concurrency: 1 });
    const held = await gate.acquire({ inputTokens: 10, model: "m", maxTokens: 10 });
    void gate.acquire({ inputTokens: 10, model: "m", maxTokens: 10 }).then((s) => s.settle(null));

    await vi.advanceTimersByTimeAsync(GATE_SLOW_WAIT_WARN_MS + 5000);
    const waitWarnings = warn.mock.calls.filter((c) => String(c[0]).includes("waited"));
    // Thousands of polls elapsed; exactly one line.
    expect(waitWarnings).toHaveLength(1);
    expect(String(waitWarnings[0][0])).toMatch(/minimax/);
    expect(String(waitWarnings[0][0])).toMatch(/concurrency/);
    held.settle(null);
  });
});

describe("ProviderGate token accounting", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("bills a long call's overspend to the minute it landed in", async () => {
    const gate = new ProviderGate("p", { tpm: 1_000_000 });
    const slot = await gate.acquire({ inputTokens: 10_000, model: "m", maxTokens: 400_000 });
    expect(gate.snapshot().tokensThisMinute).toBe(22_000);

    // A model-max rewrite outlives the window; its reservation is pruned.
    vi.advanceTimersByTime(70_000);
    expect(gate.snapshot().tokensThisMinute).toBe(0);

    slot.settle({ prompt_tokens: 10_000, completion_tokens: 400_000, total_tokens: 410_000 });
    // The 388k that overran the reservation is charged, not silently dropped.
    expect(gate.snapshot().tokensThisMinute).toBe(410_000 - 22_000);
  });

  it("does not double-charge a call that settles inside the window", async () => {
    const gate = new ProviderGate("p", { tpm: 1_000_000 });
    const slot = await gate.acquire({ inputTokens: 10_000, model: "m", maxTokens: 400_000 });
    vi.advanceTimersByTime(5000);
    slot.settle({ prompt_tokens: 10_000, completion_tokens: 400_000, total_tokens: 410_000 });
    // Corrected in place — one entry of 410k, not 410k plus an excess event.
    expect(gate.snapshot().tokensThisMinute).toBe(410_000);
  });

  it("does not credit a new day for a call charged to the previous one", async () => {
    const gate = new ProviderGate("p", { tpd: 10_000_000 });
    const slot = await gate.acquire({ inputTokens: 10_000, model: "m", maxTokens: 50_000 });
    expect(gate.snapshot().dayTokens).toBe(22_000);

    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1000);
    expect(gate.snapshot().dayTokens).toBe(0); // rolled, even while idle

    slot.settle({ prompt_tokens: 10_000, completion_tokens: 1_000, total_tokens: 11_000 });
    // Was -10998 before the guard: a false credit against the new day's quota.
    expect(gate.snapshot().dayTokens).toBe(0);
  });

  it("still reconciles the day counter within the same day", async () => {
    const gate = new ProviderGate("p", { tpd: 10_000_000 });
    const slot = await gate.acquire({ inputTokens: 10_000, model: "m", maxTokens: 50_000 });
    slot.settle({ prompt_tokens: 10_000, completion_tokens: 1_000, total_tokens: 11_000 });
    expect(gate.snapshot().dayTokens).toBe(11_000);
  });
});

describe("throttle logging", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("never prints NaN when a same-shaped error lacks retryAfterMs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const gate = new ProviderGate("p", { rpm: 60 });
    // A copy that crossed a module boundary: right name and status, missing
    // the optional fields.
    const copy = Object.assign(new Error("429"), { name: "ProviderHttpError", status: 429 });
    const slot = await gate.acquire({ inputTokens: 10, model: "m", maxTokens: 10 });
    slot.settleError(copy);

    expect(gate.snapshot().scale).toBe(0.5); // it still paced off it
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.every((c) => !String(c[0]).includes("NaN"))).toBe(true);
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

  // Asserted directly rather than left to be implied by the "reports every
  // live gate" test below, which only catches a no-op reset because of the
  // order the tests happen to be declared in. That is fragile documentation
  // of an invariant every other test in this block depends on.
  it("drops every gate and its learned state", () => {
    const first = getGate("p", {});
    resetGates();
    expect(gateSnapshots()).toEqual([]);
    expect(getGate("p", {})).not.toBe(first);
  });

  it("updates the budget of an existing gate rather than replacing it", async () => {
    const first = getGate("p", { concurrency: 1 });
    const slot = await first.acquire({ inputTokens: 1, model: "m", maxTokens: 1 });
    const second = getGate("p", { concurrency: 9 });
    expect(second).toBe(first);
    expect(second.snapshot().inFlight).toBe(1);
    slot.settle(null);
  });

  // A caller that supplies NO budget is joining the bucket, not describing it.
  // The legacy env-keyed path (callProvider) knows the provider but not the
  // operator's stored override, so if it installed the shipped default instead,
  // the two callers would alternate between two different budgets — and because
  // setBudget resets the learned adaptive state on any change, that would switch
  // AIMD backoff OFF on exactly the providers an operator has tuned.
  /** Does the gate admit a call RIGHT NOW? `maxWaitMs: 0` makes this a probe
   *  rather than a wait. An admitted probe spends a request, so order matters. */
  const probe = async (g: ProviderGate): Promise<"admitted" | "blocked"> => {
    try {
      (await g.acquire({ inputTokens: 1, model: "m", maxTokens: 1 }, undefined, 0)).settle(null);
      return "admitted";
    } catch {
      return "blocked";
    }
  };

  it("leaves an existing gate's budget and learned pacing alone when the caller supplies none", async () => {
    const gate = getGate("p", { rpm: 4 });
    const slot = await gate.acquire({ inputTokens: 10, model: "m", maxTokens: 10 });
    slot.settleError(new ProviderHttpError("rate limited", 429, null, null));
    expect(gate.snapshot().scale).toBe(0.5);

    const joined = getGate("p");
    expect(joined).toBe(gate);
    // THE ASSERTION THAT PINS THE BUG: a budget-less caller that installed the
    // shipped default instead would look like a CHANGED budget to setBudget and
    // reset this to 1 — i.e. "no congestion ever seen" — which is how the
    // adaptive backoff gets switched off rather than merely degraded.
    expect(joined.snapshot().scale).toBe(0.5);
    // And the budget itself survives: rpm 4 at scale 0.5 admits 2 a minute, one
    // of which the 429'd call already spent.
    expect(await probe(joined)).toBe("admitted");
    expect(await probe(joined)).toBe("blocked");
  });

  it("creates an unpaced gate when a budget-less caller gets there first", async () => {
    // Accepted and documented: brief, self-correcting, and strictly better than
    // two budgets fighting. The next routed call installs the real one.
    const gate = getGate("p");
    expect(await probe(gate)).toBe("admitted");
    const routed = getGate("p", { rpm: 1 });
    expect(routed).toBe(gate);
    // rpm 1, already spent by the probe above — so the real budget did land.
    expect(await probe(routed)).toBe("blocked");
  });

  it("reports every live gate for the settings screen", () => {
    getGate("minimax", {});
    getGate("gemini", {});
    expect(gateSnapshots().map((s) => s.key).sort()).toEqual(["gemini", "minimax"]);
  });

  // CRITICAL: getGate calls setBudget on every lookup, including the common
  // case where the caller (e.g. resolveBudget) builds a fresh but VALUE-EQUAL
  // budget object each time. If setBudget compared budgets by reference rather
  // than by value, every single getGate call would look like a "changed"
  // budget and would reset the learned adaptive scale — silently destroying
  // all rate-limit adaptation while every other test still passed.
  it("does not reset learned pacing when repeatedly handed a fresh but equal budget object", async () => {
    const gate = getGate("minimax", { rpm: 60, tpm: 500_000 });
    const slot = await gate.acquire({ inputTokens: 10, model: "m", maxTokens: 10 });
    slot.settleError(new ProviderHttpError("rate limited", 429, null, null));
    expect(gate.snapshot().scale).toBe(0.5);

    // Each call constructs a brand-new object, equal by value but never the
    // same reference as the one before it — exactly what resolveBudget() does.
    for (let i = 0; i < 5; i++) {
      const same = getGate("minimax", { rpm: 60, tpm: 500_000 });
      expect(same).toBe(gate);
      expect(same.snapshot().scale).toBe(0.5);
    }
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

  it("carries the caller's label so the provider is named in the abort", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(sleep(1000, ac.signal, "minimax rate gate")).rejects.toThrow(/minimax rate gate/);
  });

  it("rejects an in-flight sleep when the signal fires later", async () => {
    const ac = new AbortController();
    const pending = sleep(60_000, ac.signal, "minimax rate gate");
    const assertion = expect(pending).rejects.toThrow(/minimax rate gate/);
    ac.abort();
    await assertion;
  });
});
