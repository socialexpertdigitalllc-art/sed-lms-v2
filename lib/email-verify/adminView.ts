import { PROVIDER_REGISTRY, getDescriptor } from "./registry";
import { getProviderConfigStatuses } from "./config";
import { getAllProviderQuotas, type ProviderQuota } from "./balance";
import type { ProviderCredentialField } from "./registry";

/**
 * The one client-safe projection of a provider's settings row.
 *
 * SERVER ONLY. Both the settings API and the admin page render from this, so
 * the two can never drift — and neither can leak a credential, because this
 * shape has no field that could carry one. `configured` + `hint` is all the
 * client ever learns about what is stored.
 */
export interface ProviderSetting {
  key: string;
  label: string;
  fields: ProviderCredentialField[];
  freeLimit: number;
  period: "day" | "month";
  docsUrl: string;
  supportsBalance: boolean;
  privacyNote: string;
  enabled: boolean;
  priority: number;
  configured: boolean;
  /** Username, or the last 4 of an API key. Never the secret. */
  hint: string | null;
  updatedAt: string | null;
  quota: ProviderQuota | null;
}

/**
 * Every registry provider with its stored state and live quota, in priority
 * order. Quota lookups are cached ~60s upstream and never throw.
 */
export async function listProviderSettings(): Promise<ProviderSetting[]> {
  const [statuses, quotas] = await Promise.all([getProviderConfigStatuses(), getAllProviderQuotas()]);
  const statusByKey = new Map(statuses.map((s) => [s.key, s]));
  const quotaByKey = new Map(quotas.map((q) => [q.key, q]));

  const providers: ProviderSetting[] = statuses.map((s) => {
    const d = getDescriptor(s.key);
    return {
      key: s.key,
      label: d?.label ?? s.key,
      fields: d?.fields ?? [],
      freeLimit: d?.freeLimit ?? 0,
      period: d?.period ?? "day",
      docsUrl: d?.docsUrl ?? "",
      supportsBalance: d?.supportsBalance ?? false,
      privacyNote: d?.privacyNote ?? "",
      enabled: s.enabled,
      priority: s.priority,
      configured: s.configured,
      hint: s.hint,
      updatedAt: s.updatedAt,
      quota: quotaByKey.get(s.key) ?? null,
    };
  });

  // Registry entries with no status row should be impossible, but never hide a
  // provider from the settings page just because the config read came up empty.
  for (const d of PROVIDER_REGISTRY) {
    if (statusByKey.has(d.key)) continue;
    providers.push({
      key: d.key,
      label: d.label,
      fields: d.fields,
      freeLimit: d.freeLimit,
      period: d.period,
      docsUrl: d.docsUrl,
      supportsBalance: d.supportsBalance,
      privacyNote: d.privacyNote,
      enabled: false,
      priority: PROVIDER_REGISTRY.indexOf(d),
      configured: false,
      hint: null,
      updatedAt: null,
      quota: quotaByKey.get(d.key) ?? null,
    });
  }

  return providers;
}
