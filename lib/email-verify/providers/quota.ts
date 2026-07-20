import { PROVIDER_LIMITS } from "./types";
import type { ProviderName } from "../types";

/**
 * Quota handling is belt-and-braces:
 *
 *  (a) PROACTIVE — we count our own calls per provider per period and refuse to
 *      spend the last of a tiny free tier by accident (Verifalia 25/day,
 *      Reoon 600/month).
 *  (b) REACTIVE — if the provider itself says "out of credit" (Verifalia HTTP
 *      402, Reoon an error payload mentioning credits/limit) we park it until
 *      the period rolls over. **The provider's answer wins**: our counter can
 *      drift (other integrations, retries, a manual top-up), theirs cannot.
 *
 * The reset boundary is assumed to be UTC. Being an hour or two pessimistic
 * only costs us a delayed retry, never a wasted billable call.
 */

/** Bucket identifier for the current period, e.g. "2026-07-20" or "2026-07". */
export function periodKey(provider: ProviderName, now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  if (PROVIDER_LIMITS[provider].period === "month") return `${y}-${m}`;
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** When the current period ends (= when a provider-declared exhaustion lifts). */
export function periodEnd(provider: ProviderName, now: Date = new Date()): Date {
  if (PROVIDER_LIMITS[provider].period === "month") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
}

/**
 * Is the provider usable right now? Combines the reactive park flag with the
 * proactive counter. A stale `periodKey` means the counter belongs to an
 * expired period and is treated as zero.
 */
export function isProviderAvailable(
  provider: ProviderName,
  state: { exhaustedUntil: Date | null; periodKey: string; callsUsed: number },
  now: Date = new Date()
): { available: boolean; reason?: "parked" | "counter" } {
  if (state.exhaustedUntil && state.exhaustedUntil.getTime() > now.getTime()) {
    return { available: false, reason: "parked" };
  }
  const key = periodKey(provider, now);
  const used = state.periodKey === key ? state.callsUsed : 0;
  if (used >= PROVIDER_LIMITS[provider].limit) return { available: false, reason: "counter" };
  return { available: true };
}

export { PROVIDER_LIMITS };
