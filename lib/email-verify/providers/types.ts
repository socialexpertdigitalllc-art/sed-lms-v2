import type { ProviderName, RemoteResult } from "../types";

/** Every adapter implements this. `isConfigured()` is false when the credential is missing/blank. */
export type ProviderAdapter = {
  name: ProviderName;
  isConfigured(): boolean;
  verify(email: string, opts?: { timeoutMs?: number }): Promise<RemoteResult>;
};

/** Free-tier allowances, used for the PROACTIVE counter only. */
export const PROVIDER_LIMITS: Record<ProviderName, { limit: number; period: "day" | "month" }> = {
  verifalia: { limit: 25, period: "day" },
  reoon: { limit: 600, period: "month" },
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
