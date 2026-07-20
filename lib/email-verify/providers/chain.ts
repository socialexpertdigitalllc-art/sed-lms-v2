import { isProviderAvailable, periodEnd, periodKey } from "./quota";
import type { ProviderAdapter, ProviderCredentials, ProviderStateStore } from "./types";
import type { ProviderName, ProviderSignal } from "../types";

/**
 * Provider chain: ordered by the user's configuration → local-only.
 *
 * We fall through on quota exhaustion (proactive counter OR the provider's own
 * answer), on a missing credential, on a disabled provider, and on a hard
 * error. If nobody answers the caller still gets the local verdict — clearly
 * labelled `localOnly`.
 *
 * `configs` is optional. When supplied it decides ORDER, ENABLEMENT and
 * CREDENTIALS; when omitted the adapters are tried in the order given and fall
 * back to their environment variables (the pre-config-store behaviour).
 */

export type ChainAttempt = {
  provider: ProviderName;
  outcome: "ok" | "quota" | "auth" | "error" | "skipped_quota" | "not_configured" | "disabled";
  message?: string;
};

export type ChainOutcome = {
  /** Which provider actually answered, or null for a local-only result. */
  provider: ProviderName | null;
  signal: ProviderSignal | null;
  raw: unknown;
  attempts: ChainAttempt[];
};

/** Just enough of a config row for the chain — decoupled from the store. */
export type ChainProviderConfig = {
  key: string;
  enabled: boolean;
  priority: number;
  credentials: ProviderCredentials | null;
};

/**
 * Order the adapters by configured priority and drop the ones the user turned
 * off. Pure, so the ordering rule is testable without a database.
 *
 * With no config at all the adapter array is returned untouched: a deployment
 * that has never opened the settings page still behaves exactly as before.
 */
export function orderProviders(
  providers: ProviderAdapter[],
  configs?: ChainProviderConfig[] | null
): { adapter: ProviderAdapter; config: ChainProviderConfig | null }[] {
  if (!configs) return providers.map((adapter) => ({ adapter, config: null }));
  const byKey = new Map(providers.map((p) => [p.name as string, p]));
  return configs
    .slice()
    .sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key))
    .map((config) => ({ adapter: byKey.get(config.key), config }))
    .filter((x): x is { adapter: ProviderAdapter; config: ChainProviderConfig } => x.adapter !== undefined);
}

export async function runProviderChain(
  email: string,
  deps: {
    providers: ProviderAdapter[];
    state: ProviderStateStore;
    configs?: ChainProviderConfig[] | null;
    now?: () => Date;
    timeoutMs?: number;
  }
): Promise<ChainOutcome> {
  const now = deps.now ?? (() => new Date());
  const attempts: ChainAttempt[] = [];

  for (const { adapter: provider, config } of orderProviders(deps.providers, deps.configs)) {
    if (config && !config.enabled) {
      attempts.push({ provider: provider.name, outcome: "disabled" });
      continue;
    }
    const credentials = config?.credentials ?? undefined;
    if (!provider.isConfigured(credentials)) {
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

    const result = await provider.verify(email, { timeoutMs: deps.timeoutMs, credentials });

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
