import type { UploadFailure } from "./types";

const QUOTA_RE = /rate limit|too many requests|quota|limit reached|limit exceeded|exceeded/i;
const AUTH_RE = /invalid api key|invalid key|invalid token|unauthorized|unauthenticated|forbidden/i;

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
  if (input.rateLimitRemaining === "0") return "quota";
  if (input.status === 429) return "quota";
  if (input.status === 401 || input.status === 403) return "auth";
  const msg = input.message ?? "";
  if (QUOTA_RE.test(msg)) return "quota";
  if (AUTH_RE.test(msg)) return "auth";
  return "error";
}
