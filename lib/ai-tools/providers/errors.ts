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
 *
 * FRACTIONAL delta-seconds are accepted even though RFC 9110 says integer.
 * Vendors send `Retry-After: 1.5`, and matching integers only was not a
 * harmless strictness: `"1.5"` fell through to the HTTP-date branch, where
 * V8's `Date.parse` resolves it to 2001-01-04 — long past, so the clamp below
 * returned 0 and the caller retried FOUR TIMES WITH NO DELAY AT ALL, the exact
 * inverse of what the vendor asked for.
 *
 * This applies NO upper bound. The caller owns clamping (a later task caps
 * the wait at 60s) — nobody should assume that clamp lives here, because a
 * vendor sending an absurd value (a stuck clock, a multi-hour outage notice)
 * must not silently block a caller that has its own ceiling in mind.
 */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  }
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

const numberHeader = (headers: Headers, name: string): number | undefined => {
  // `.trim()` before the falsy check, not after: `Number("")` is `0`, and
  // `remaining: 0` is the one value that means "stop" — an empty header must
  // drop the field, never fabricate a real zero.
  const raw = headers.get(name)?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * The `x-ratelimit-*` trio, when the vendor sends it. Verified 2026-07-28:
 * of the four providers this app supports, ONLY Gemini documents these. They
 * are therefore read opportunistically to refine a budget we already hold —
 * never as the source of one.
 *
 * ASSUMPTION: `x-ratelimit-reset` is read as SECONDS REMAINING (delta), not
 * an absolute epoch — matching Gemini's documented behaviour. A vendor that
 * instead sent an epoch would produce a nonsense `resetMs`. That is tolerable
 * only because this whole struct is diagnostic and is never the source of a
 * budget decision (see WHY THIS EXISTS above).
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

/**
 * The one place a call-timeout message is worded. `isRetryableError` matches
 * on `CALL_TIMEOUT_MARKER`, so rewording the message here can never silently
 * make every provider timeout terminal — which is exactly the risk an inline
 * template literal duplicated in `run.ts` would carry.
 */
export const CALL_TIMEOUT_MARKER = "call timed out after";
export const callTimedOutMessage = (label: string, timeoutMs: number): string =>
  `${label} ${CALL_TIMEOUT_MARKER} ${Math.round(timeoutMs / 1000)}s`;

/** 408 is included alongside the spec's list: a server-side request timeout is
 *  exactly as transient as a 503, and retrying it is free of side effects. */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const RETRYABLE_NET_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "EPIPE", "ENOTFOUND"]);

/**
 * Read `.status` off a provider failure by `instanceof` first, then by
 * `.name` — mirroring the convention `abort.ts` uses for `AiCallAborted`
 * (name-checked alongside `instanceof` because an error that crossed a
 * module boundary, e.g. a duplicate module instance under a bundler, keeps
 * its `.name` and own properties even when `instanceof` fails). The `.status`
 * read stays defensive (typeof-checked) rather than assumed, since a
 * name-alone match gives no static guarantee of shape.
 */
function providerStatus(e: unknown): number | null {
  if (e instanceof ProviderHttpError) return e.status;
  if (e instanceof Error && e.name === "ProviderHttpError") {
    const status = (e as unknown as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return null;
}

/**
 * Is retrying this failure capable of succeeding? A terminal failure (bad
 * request, bad key, model not found) cannot, and retrying it spends quota a
 * concurrent run needs. An operator abort is never retried — that is
 * disobedience, not resilience (see abort.ts).
 *
 * The `TypeError` case is narrowed to `fetch failed` specifically (undici's
 * wording for a network-layer failure) rather than any `TypeError` — a real
 * programming bug inside the retried region (e.g. calling a method on
 * `undefined` while parsing a response) is also a `TypeError`, and retrying
 * *that* every attempt would burn quota while misreporting a bug as a
 * transient network fault, which is the exact misdiagnosis this module
 * exists to eliminate.
 */
export function isRetryableError(e: unknown): boolean {
  if (isAbortedError(e)) return false;
  const status = providerStatus(e);
  if (status !== null) return RETRYABLE_STATUS.has(status);
  if (e instanceof Error) {
    if (e.message.includes(CALL_TIMEOUT_MARKER)) return true;
    if (e.name === "TypeError" && /fetch failed/i.test(e.message)) return true;
    // A failed `fetch` throws a `TypeError` whose own `.code` is undefined —
    // the errno lives one level down, on `.cause` (Node's undici sets this).
    // A plain `Error` may also carry a `.cause` with a `.code`, so both are
    // read the same way rather than assuming the errno sits directly on `e`.
    const code =
      (e as NodeJS.ErrnoException).code ?? (e as unknown as { cause?: NodeJS.ErrnoException }).cause?.code;
    if (typeof code === "string" && RETRYABLE_NET_CODES.has(code)) return true;
  }
  return false;
}

/** Specifically throttled — the one failure that must adapt the gate's budget
 *  and must NOT trigger provider fallback (see providers/run.ts). */
export function isRateLimitError(e: unknown): boolean {
  return providerStatus(e) === 429;
}
