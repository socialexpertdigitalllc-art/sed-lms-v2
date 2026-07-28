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
 * never as the source of one.
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
