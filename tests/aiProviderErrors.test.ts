// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  ProviderHttpError,
  parseRetryAfter,
  rateLimitHeadersFrom,
  isRetryableError,
  isRateLimitError,
  callTimedOutMessage,
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

  it("reads a partial trio independently, proving the three guards don't gate each other", () => {
    expect(rateLimitHeadersFrom(new Headers({ "x-ratelimit-remaining": "3" }))).toEqual({ remaining: 3 });
  });

  it("drops a non-numeric header value rather than reporting a bogus number", () => {
    expect(rateLimitHeadersFrom(new Headers({ "x-ratelimit-remaining": "unlimited" }))).toBeNull();
  });

  it("drops an empty header value rather than reporting a real zero", () => {
    // `remaining: 0` is the one value that means "stop" — an empty string
    // must never be coerced into it via `Number("") === 0`.
    expect(rateLimitHeadersFrom(new Headers({ "x-ratelimit-remaining": "" }))).toBeNull();
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

  it("treats a call timeout as retryable via the shared message builder", () => {
    // Built with the same function `run.ts` uses to throw the timeout, so a
    // reworded message can never silently drift out of what this matches.
    expect(isRetryableError(new Error(callTimedOutMessage("MiniMax M3", 300_000)))).toBe(true);
  });

  it("treats the real shape of a failed fetch as retryable", () => {
    // Node/undici's actual shape: a `TypeError` named "fetch failed" whose
    // own `.code` is undefined — the errno lives on `.cause`.
    const fetchFailure = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect ECONNRESET"), { code: "ECONNRESET" }),
    });
    expect(isRetryableError(fetchFailure)).toBe(true);
  });

  it("also treats a bare Error carrying the errno on .cause as retryable", () => {
    const causedError = Object.assign(new Error("boom"), { cause: { code: "ECONNRESET" } });
    expect(isRetryableError(causedError)).toBe(true);
  });

  it("does not retry an unrelated TypeError raised inside the retried region", () => {
    // A programming bug (e.g. reading a property of undefined while parsing
    // a response) is also a TypeError. Retrying it would burn quota while
    // misreporting a bug as a transient network fault.
    expect(isRetryableError(new TypeError("Cannot read properties of undefined (reading 'foo')"))).toBe(false);
  });

  it("never retries an operator abort", () => {
    expect(isRetryableError(new AiCallAborted("MiniMax M3"))).toBe(false);
  });

  it("identifies a rate limit specifically", () => {
    expect(isRateLimitError(err(429))).toBe(true);
    expect(isRateLimitError(err(503))).toBe(false);
    expect(isRateLimitError(new Error("nope"))).toBe(false);
  });

  it("carries retryAfterMs and rateLimit through to the catch site", () => {
    const rateLimit = { limit: 500, remaining: 0, resetMs: 30_000 };
    const e = new ProviderHttpError("Too Many Requests", 429, 30_000, rateLimit);
    expect(e.retryAfterMs).toBe(30_000);
    expect(e.rateLimit).toEqual(rateLimit);
    expect(isRateLimitError(e)).toBe(true);
  });
});
