import { isProviderAvailable, periodEnd, periodKey } from "./quota";
import type { ProviderAdapter, ProviderStateStore } from "./types";
import type { ProviderName, ProviderSignal } from "../types";

/**
 * Provider chain: Verifalia (primary) → Reoon (fallback) → local-only.
 *
 * We fall through on quota exhaustion (proactive counter OR the provider's own
 * answer), on a missing credential, and on a hard error. If nobody answers the
 * caller still gets the local verdict — clearly labelled `localOnly`.
 */

export type ChainAttempt = {
  provider: ProviderName;
  outcome: "ok" | "quota" | "auth" | "error" | "skipped_quota" | "not_configured";
  message?: string;
};

export type ChainOutcome = {
  /** Which provider actually answered, or null for a local-only result. */
  provider: ProviderName | null;
  signal: ProviderSignal | null;
  raw: unknown;
  attempts: ChainAttempt[];
};

export async function runProviderChain(
  email: string,
  deps: { providers: ProviderAdapter[]; state: ProviderStateStore; now?: () => Date; timeoutMs?: number }
): Promise<ChainOutcome> {
  const now = deps.now ?? (() => new Date());
  const attempts: ChainAttempt[] = [];

  for (const provider of deps.providers) {
    if (!provider.isConfigured()) {
      attempts.push({ provider: provider.name, outcome: "not_configured" });
      continue;
    }

    const at = now();
    const state = await deps.state.get(provider.name);
    const availability = isProviderAvailable(provider.name, state, at);
    if (!availability.available) {
      attempts.push({ provider: provider.name, outcome: "skipped_quota", message: availability.reason });
      continue;
    }

    // Count BEFORE the call: an optimistic counter can only make us cautious,
    // whereas counting after would under-count on a crash mid-request.
    await deps.state.recordCall(provider.name, periodKey(provider.name, at));

    const result = await provider.verify(email, { timeoutMs: deps.timeoutMs });

    if (result.ok) {
      attempts.push({ provider: provider.name, outcome: "ok" });
      return {
        provider: provider.name,
        signal: {
          provider: provider.name,
          status: result.status,
          classification: result.classification,
          detail: result.detail,
        },
        raw: result.raw,
        attempts,
      };
    }

    if (result.reason === "quota") {
      // The provider's own answer is authoritative — park it until the period
      // rolls over, regardless of what our counter believes.
      await deps.state.markExhausted(provider.name, periodEnd(provider.name, at), result.message);
    } else {
      await deps.state.recordError(provider.name, result.message);
    }
    attempts.push({ provider: provider.name, outcome: result.reason, message: result.message });
  }

  return { provider: null, signal: null, raw: null, attempts };
}
