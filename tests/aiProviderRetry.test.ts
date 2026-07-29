// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { backoffDelayMs, callWithProvider, MAX_ATTEMPTS, type ProviderSpec } from "@/lib/ai-tools/run";
import { ProviderHttpError } from "@/lib/ai-tools/providers/errors";
import { getGate, resetGates } from "@/lib/ai-tools/providers/gate";
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

  it("buckets by endpoint host when no provider key is given", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(okBody));
    const keyless: ProviderSpec = { label: "L", endpoint: "https://api.example.com/v1/x", apiKey: "k", maxOutputTokens: 100 };
    await callWithProvider(keyless, "m1", "s", "u", { maxTokens: 10, temperature: 0 });
    expect(getGate("api.example.com", {}).snapshot().requestsThisMinute).toBe(1);
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
});
