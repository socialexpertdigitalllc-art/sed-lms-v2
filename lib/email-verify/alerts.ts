import { notify } from "@/lib/notifications/notify";
import { getDescriptor } from "./registry";
import { periodKey } from "./providers/quota";
import type { ProviderName } from "./types";

/**
 * "Your verification provider is nearly out of credit" bell.
 *
 * Fires when a provider crosses 80% of its period allowance, or when it starts
 * failing hard (auth errors, repeated errors). The dedup key carries BOTH the
 * provider and the period key, so a busy day raises exactly one bell per
 * provider per period rather than one per verification.
 */

export const QUOTA_WARN_THRESHOLD = 0.8;
/** Consecutive auth/hard failures before we treat a provider as broken. */
export const ERROR_ALERT_THRESHOLD = 3;

export type QuotaAlertReason = "quota" | "errors";

/** Pure: has this provider crossed the warning line? */
export function shouldWarnQuota(used: number, limit: number, threshold = QUOTA_WARN_THRESHOLD): boolean {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return false;
  return used / limit >= threshold;
}

/** Pure: one bell per provider, per period, per reason. */
export function quotaAlertDedupKey(provider: string, period: string, reason: QuotaAlertReason = "quota"): string {
  return `email_verify_quota_low:${provider}:${period}:${reason}`;
}

/** Pure: the bell copy. Never includes a credential or a vendor error verbatim. */
export function quotaAlertText(
  provider: string,
  reason: QuotaAlertReason,
  info: { used?: number; limit?: number; remaining?: number | null }
): { title: string; body: string } {
  const label = getDescriptor(provider)?.label ?? provider;
  if (reason === "errors") {
    return {
      title: `${label} is failing`,
      body: `${label} rejected or errored on repeated verification requests. Check its credentials in email provider settings.`,
    };
  }
  const remaining =
    typeof info.remaining === "number"
      ? info.remaining
      : typeof info.used === "number" && typeof info.limit === "number"
        ? Math.max(0, info.limit - info.used)
        : null;
  const tail = remaining === null ? "" : ` — about ${remaining} left`;
  return {
    title: `${label} verification quota is nearly used up`,
    body: `${label} has passed ${Math.round(QUOTA_WARN_THRESHOLD * 100)}% of its free allowance for this period${tail}.`,
  };
}

/**
 * Raise the bell. Best-effort in every direction: an event with no seeded rule
 * silently no-ops, and a failure here must never affect a verification.
 */
export async function maybeNotifyQuotaLow(
  provider: string,
  state: { used: number; limit: number; remaining?: number | null },
  opts: { reason?: QuotaAlertReason; now?: Date; threshold?: number } = {}
): Promise<boolean> {
  const reason = opts.reason ?? "quota";
  const now = opts.now ?? new Date();
  if (reason === "quota" && !shouldWarnQuota(state.used, state.limit, opts.threshold)) return false;

  // An unknown key would blow up periodKey's limits lookup — degrade to the day.
  const period = getDescriptor(provider) ? periodKey(provider as ProviderName, now) : now.toISOString().slice(0, 10);
  const { title, body } = quotaAlertText(provider, reason, state);
  try {
    await notify(
      "email_verify_quota_low",
      {},
      { title, body, dedupKey: quotaAlertDedupKey(provider, period, reason), targetUrl: "/admin/email-providers" }
    );
    return true;
  } catch {
    return false;
  }
}
