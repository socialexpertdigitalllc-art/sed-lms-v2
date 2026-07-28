import type { UploadFailure } from "./types";

// Deliberately no bare `exceeded` alternative: imgbb's "maximum file size
// exceeded" is a size error, not a quota one. A size-limit error must stay
// `error` — parking a healthy key for an hour because one photo was too big
// is far worse than the retry it gets instead.
const QUOTA_RE = /rate limit|too many requests|quota|limit reached|limit exceeded/i;
// Deliberately no bare `forbidden` or `unauthorized`: those words show up on
// WAF/geo/proxy block pages that have nothing to do with our credentials.
// Only phrasing that specifically names a bad key/token counts as `auth`.
const AUTH_RE = /invalid api ?key|invalid key|invalid token|unauthenticated|api ?key (?:is )?(?:missing|required|invalid)/i;

/**
 * Decide what a failed upload means for the HOST, not the photo.
 *
 * - `quota` → park the host for a cooldown; it comes back by itself.
 * - `auth`  → disable the host; a wrong key does not fix itself and retrying
 *             it on every photo would burn the whole batch.
 * - `error` → transient; retry the same host briefly, then move on.
 *
 * imgbb publishes no quota at all (see the design, §8), so message matching is
 * the only signal available for it.
 */
export function classifyUploadError(input: {
  status: number;
  message?: string;
  /** imgchest's `X-RateLimit-Remaining` header, when present. */
  rateLimitRemaining?: string | null;
}): UploadFailure {
  // Structured signals first, free text last: a header or status code is a
  // fact the provider reported about itself; a message is prose someone
  // wrote for humans and is the more fragile signal.
  if (input.rateLimitRemaining === "0") return "quota";
  if (input.status === 429) return "quota";
  // 401 only: none of the three providers' real bad-credential responses use
  // 403 (imgbb: 400 + "Invalid API key"; imgchest: 401 Unauthenticated;
  // postimages: no auth at all) — 403 is what a WAF/geo-block/policy
  // rejection returns, and disablement has no cooldown, so a false positive
  // here permanently benches a healthy key.
  if (input.status === 401) return "auth";
  const msg = input.message ?? "";
  if (QUOTA_RE.test(msg)) return "quota";
  if (AUTH_RE.test(msg)) return "auth";
  return "error";
}
