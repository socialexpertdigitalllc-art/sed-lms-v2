import type { ProviderName, RemoteResult } from "../types";

/** Field-keyed credentials for one provider, as described by the registry. */
export type ProviderCredentials = Record<string, string>;

export type VerifyOpts = { timeoutMs?: number; credentials?: ProviderCredentials | null };

/**
 * Every adapter implements this. Credentials are passed IN (from the config
 * store) rather than read from the environment; when they are omitted the
 * adapter falls back to its env vars, which is what keeps a bare `verifyEmail`
 * call and the existing tests working.
 *
 * `isConfigured()` is false when the credential is missing/blank.
 */
export type ProviderAdapter = {
  name: ProviderName;
  isConfigured(credentials?: ProviderCredentials | null): boolean;
  verify(email: string, opts?: VerifyOpts): Promise<RemoteResult>;
};

/** Free-tier allowances, used for the PROACTIVE counter only. */
export const PROVIDER_LIMITS: Record<ProviderName, { limit: number; period: "day" | "month" }> = {
  verifalia: { limit: 25, period: "day" },
  reoon: { limit: 600, period: "month" },
  mailrook: { limit: 5, period: "day" },
  inboxtrue: { limit: 1000, period: "month" },
  check_mail: { limit: 1000, period: "month" },
};

/** Persistence the chain needs. Injected so the chain is unit-testable. */
export type ProviderStateStore = {
  /** Current state: is the provider parked, and how many calls used this period. */
  get(provider: ProviderName): Promise<{ exhaustedUntil: Date | null; periodKey: string; callsUsed: number }>;
  /** Increment the proactive counter for the current period. */
  recordCall(provider: ProviderName, periodKey: string): Promise<void>;
  /** Park the provider until the period rolls over (reactive, provider-authoritative). */
  markExhausted(provider: ProviderName, until: Date, message: string): Promise<void>;
  /** Record a non-quota failure for observability. */
  recordError(provider: ProviderName, message: string): Promise<void>;
};

export { type RemoteResult };
