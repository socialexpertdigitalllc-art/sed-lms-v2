// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { backoffDelayMs, callWithProvider, GATE_MAX_WAIT_MS, MAX_ATTEMPTS, type ProviderSpec } from "@/lib/ai-tools/run";
import { isRetryableError, ProviderHttpError } from "@/lib/ai-tools/providers/errors";
import { GateTimeoutError, gateSnapshots, getGate, resetGates } from "@/lib/ai-tools/providers/gate";
import { AiCallAborted } from "@/lib/ai-tools/abort";

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

  it("surfaces an operator abort as AiCallAborted after exactly one call", async () => {
    // What this actually proves is the end-to-end contract, NOT the loop's
    // `isAbortedError` guard. That guard is belt-and-braces: `isRetryableError`
    // itself opens with `if (isAbortedError(e)) return false;`, so the two
    // classify an identical set and no test can discriminate the guard without
    // editing errors.ts. Verified — the loop can be stripped of BOTH and this
    // still passes, because an aborted signal is sticky and `attemptCall`'s
    // pre-flight check then throws before reaching the wire on every later
    // attempt. The test below ("abandons a pending backoff") covers the abort
    // behaviour that IS falsifiable here.
    const ac = new AbortController();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      ac.abort();
      return Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    });

    const promise = callWithProvider(spec, "m1", "s", "u", { maxTokens: 100, temperature: 0, signal: ac.signal });
    await expect(promise).rejects.toBeInstanceOf(AiCallAborted);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("abandons a pending backoff the moment the operator stops the run", async () => {
    // The backoff sleep is handed `opts.signal` so a Stop is honoured while a
    // call is PARKED, not only while it is on the wire. Drop that argument and
    // an aborted run sits out the vendor's full 60s Retry-After and then fires
    // another PAID request. Note the failure is one of TIMING, not outcome:
    // without the signal the run still ends in AiCallAborted, because the next
    // attempt's `gate.acquire` sees the aborted signal — just a minute later,
    // which is why this asserts WHEN it settles rather than only how.
    const ac = new AbortController();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ error: { message: "limited" } }, { status: 429, headers: { "retry-after": "60" } }));

    let settled = false;
    const outcome = callWithProvider(spec, "m1", "s", "u", {
      maxTokens: 100,
      temperature: 0,
      signal: ac.signal,
    }).catch((e) => {
      settled = true;
      return e;
    });

    // Deep inside the 60s backoff, and nowhere near its end.
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(false);

    ac.abort();
    await vi.advanceTimersByTimeAsync(10);

    expect(settled).toBe(true);
    expect(await outcome).toBeInstanceOf(AiCallAborted);
    // Crucially: the second request was never paid for.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

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

    // Looked up with the SAME budget the call installed. `getGate` re-applies
    // whatever budget it is handed, and a CHANGED budget deliberately resets
    // the adaptive scale to 1 (see ProviderGate.setBudget) — so asserting
    // through `getGate(key, {})` would read a scale the assertion itself had
    // just wiped, and pass no matter what the production code did.
    expect(getGate("testprov", { concurrency: 4 }).snapshot().scale).toBe(0.5);
  });

  it("releases its slot even when the call throws", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: { message: "nope" } }, { status: 400 }));
    const gated: ProviderSpec = { ...spec, rateBudget: { concurrency: 1 } };

    await callWithProvider(gated, "m1", "s", "u", { maxTokens: 100, temperature: 0 }).catch(() => {});

    expect(getGate("testprov", { concurrency: 1 }).snapshot().inFlight).toBe(0);
  });

  it("lets a budget-less caller share the bucket without overwriting its budget", async () => {
    // The two production shapes side by side: the routed path knows the
    // operator's budget, the legacy env-keyed path (callProvider) knows only
    // which provider it is. They must land in ONE bucket, and the one that does
    // not know the budget must not overwrite the one that does — otherwise the
    // budgets alternate and `setBudget` resets the learned adaptive state on
    // every call, switching AIMD backoff off on exactly the tuned providers.
    // A fresh Response per call: a body may only be read once.
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse(okBody));
    const routed: ProviderSpec = { ...spec, rateBudget: { rpm: 2 } };
    const legacy: ProviderSpec = { ...spec };
    expect(legacy.rateBudget).toBeUndefined();

    await callWithProvider(routed, "m1", "s", "u", { maxTokens: 10, temperature: 0 });
    await callWithProvider(legacy, "m1", "s", "u", { maxTokens: 10, temperature: 0 });

    // ONE bucket: the legacy spec's endpoint host never got a gate of its own.
    expect(gateSnapshots().map((s) => s.key)).toEqual(["testprov"]);
    expect(getGate("testprov").snapshot().requestsThisMinute).toBe(2);

    // rpm 2 is now spent — and it is still rpm 2, not the `{}` a clobbering
    // caller would have installed, so the next call has to WAIT for the window.
    let third = false;
    const pending = callWithProvider(legacy, "m1", "s", "u", { maxTokens: 10, temperature: 0 }).then((r) => {
      third = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(third).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60_000); // the window rolls
    await pending;
    expect(third).toBe(true);
  });

  it("buckets by endpoint host when no provider key is given", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(okBody));
    const keyless: ProviderSpec = { label: "L", endpoint: "https://api.example.com/v1/x", apiKey: "k", maxOutputTokens: 100 };
    await callWithProvider(keyless, "m1", "s", "u", { maxTokens: 10, temperature: 0 });
    expect(getGate("api.example.com", {}).snapshot().requestsThisMinute).toBe(1);
  });

  it("fails a call the budget cannot admit soon, instead of parking it for hours", async () => {
    // `tpd` is the dimension that can compute a multi-hour wait: a call larger
    // than the whole daily quota blocks until the 24h window rolls. Unbounded,
    // `acquire` dutifully polled that out in 1s slices — ~86,400 wakeups, a
    // caller parked for a day, and nothing to break it since Site Builder
    // passes no signal. Now the wait is capped at GATE_MAX_WAIT_MS.
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(okBody));
    const capped: ProviderSpec = { ...spec, rateBudget: { tpd: 1 } };

    let settled = false;
    const outcome = callWithProvider(capped, "m1", "s", "u", { maxTokens: 100, temperature: 0 }).catch((e) => {
      settled = true;
      return e;
    });

    // Still parked just short of the bound — the cap is what ends this, not
    // some unrelated early exit.
    await vi.advanceTimersByTimeAsync(GATE_MAX_WAIT_MS - 2000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(settled).toBe(true);

    const err = await outcome;
    expect(err).toBeInstanceOf(GateTimeoutError);
    expect((err as GateTimeoutError).dimension).toBe("tpd");
    // Retryable, so callForTask does not silently reroute a merely-busy
    // provider onto a different model (see providers/run.ts).
    expect(isRetryableError(err)).toBe(true);
    // And no request was ever paid for — the gate never admitted one.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts a retried burst of 429s as ONE congestion event, not four", async () => {
    // Four attempts each throttled. The gate's THROTTLE_COOLDOWN_MS (5s) is
    // what keeps this from compounding, and the retry schedule is what has to
    // stay inside it: with no vendor Retry-After the gaps are jittered at most
    // 1s, 2s and 4s, so every retry lands within the cooldown of the previous
    // 429 and only the FIRST backs the budget off. Without that guard four
    // reports of one wall would take the scale to 0.0625 and effectively pin
    // the provider for the rest of the run.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: { message: "limited" } }, { status: 429 }));
    const gated: ProviderSpec = { ...spec, rateBudget: { concurrency: 4 } };

    const settled = callWithProvider(gated, "m1", "s", "u", { maxTokens: 100, temperature: 0 }).catch((e) => e);
    // Long enough for all three backoffs (<=7s), short enough to stay well
    // inside RAMP_QUIET_MS (60s) so the quiet ramp cannot mask the result.
    await vi.advanceTimersByTimeAsync(20_000);
    await settled;

    const snap = getGate("testprov", { concurrency: 4 }).snapshot();
    expect(snap.throttlesLastHour).toBe(MAX_ATTEMPTS);
    expect(snap.scale).toBe(0.5);
  });

  it("does not compound the backoff when the vendor's Retry-After outruns the cooldown", async () => {
    // The regression guard for the whole class. `Retry-After: 10` spaces the
    // four attempts 10s apart — every one of them OUTSIDE the gate's 5s
    // wall-clock cooldown, so proximity alone marks each as a fresh congestion
    // event and the scale compounds: measured at 1.00 -> 0.50 -> 0.25 -> 0.13
    // -> 0.0625, a hair above MIN_SCALE, from ONE call hitting ONE wall. It
    // also made the polite vendor the one punished hardest, which is backwards.
    // The retry loop now ASSERTS that attempts 2..n are the same event.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: { message: "limited" } }, { status: 429, headers: { "retry-after": "10" } }),
    );
    const gated: ProviderSpec = { ...spec, rateBudget: { concurrency: 4 } };

    const settled = callWithProvider(gated, "m1", "s", "u", { maxTokens: 100, temperature: 0 }).catch((e) => e);
    // Covers all three 10s waits (30s), and leaves the last throttle well
    // inside RAMP_QUIET_MS (60s) so no quiet ramp can mask the result.
    await vi.advanceTimersByTimeAsync(40_000);
    await settled;

    const snap = getGate("testprov", { concurrency: 4 }).snapshot();
    expect(snap.scale).toBe(0.5);
    // Still every one of them on the operator's health counter.
    expect(snap.throttlesLastHour).toBe(MAX_ATTEMPTS);
  });

  it("still backs off when the first failure of the call was NOT a 429", async () => {
    // A provider under load returns 5xx and 429 interleaved, and "this call
    // already failed" is not the same claim as "this call already had a 429
    // COUNTED". Flagging on attempt number alone, the 503 here counts nothing
    // and the real 429 that follows is dismissed as a repeat of it — the call
    // takes three genuine 429s and backs the budget off by NOTHING. It also
    // stamps `lastThrottleAt`, so every concurrent call's own first 429 reads
    // as a repeat for the next cooldown window too.
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ error: { message: "upstream blip" } }, { status: 503 }))
      .mockResolvedValue(jsonResponse({ error: { message: "limited" } }, { status: 429 }));
    const gated: ProviderSpec = { ...spec, rateBudget: { concurrency: 4 } };

    const settled = callWithProvider(gated, "m1", "s", "u", { maxTokens: 100, temperature: 0 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(20_000);
    await settled;

    const snap = getGate("testprov", { concurrency: 4 }).snapshot();
    expect(snap.scale).toBe(0.5);
    // Three 429s; the 503 is not a throttle and must not be counted as one.
    expect(snap.throttlesLastHour).toBe(3);
  });
});
