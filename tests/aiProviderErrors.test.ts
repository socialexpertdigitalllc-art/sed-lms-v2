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
