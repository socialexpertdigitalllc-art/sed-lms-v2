import { maybeNotifyQuotaLow } from "./alerts";
import { getProviderConfigs } from "./config";
import { resolveDomainDns } from "./dns";
import { isDisposable, isFreeProvider, isPrivacyRelay, isRoleAccount } from "./lists";
import { runProviderChain, type ChainOutcome } from "./providers/chain";
import { PROVIDER_LIMITS, periodKey } from "./providers/quota";
import { checkMail } from "./providers/check_mail";
import { mailrook } from "./providers/mailrook";
import { reoon } from "./providers/reoon";
import { verifalia } from "./providers/verifalia";
import { getDescriptor } from "./registry";
import { createProviderStateStore, getCachedDomainDns, getCachedVerification, saveDomainDns, saveVerification } from "./store";
import { parseEmail } from "./syntax";
import { suggestEmail } from "./typo";
import { computeVerdict } from "./verdict";
import type { DnsResult, LocalResult, VerificationResult } from "./types";

export { parseEmail, isValidSyntax, normalizeEmail } from "./syntax";
export { suggestDomain, suggestEmail } from "./typo";
export { isDisposable, isRoleAccount, isPrivacyRelay, isFreeProvider, isRequiredMailbox } from "./lists";
export { computeVerdict } from "./verdict";
export { resolveDomainDns, classifyMxRecords, deriveDnsStatus } from "./dns";
export { runProviderChain, orderProviders } from "./providers/chain";
export { PROVIDER_LIMITS, periodKey, periodEnd, isProviderAvailable } from "./providers/quota";
export {
  PROVIDER_REGISTRY,
  RECOMMENDED_ORDER,
  getDescriptor,
  isKnownProvider,
  hasCompleteCredentials,
  maskCredentialHint,
} from "./registry";
export { getProviderConfigStatuses, saveProviderConfig } from "./config";
export { getProviderQuota, getAllProviderQuotas } from "./balance";
export { buildScorecard, buildUsageStats, SCORECARD_MIN_SAMPLE } from "./scorecard";
export { recordSendOutcome } from "./outcomes";
export type * from "./types";

/**
 * Assemble every free signal for an address. Pure apart from the `dns` argument,
 * which the caller supplies (so this is unit-testable without the network).
 */
export function buildLocalResult(email: string, dns: DnsResult | null): LocalResult {
  const syntax = parseEmail(email);
  const domain = syntax.domain;
  return {
    input: email,
    normalized: syntax.normalized,
    localPart: syntax.localPart,
    domain,
    syntax,
    suggestion: suggestEmail(email),
    disposable: isDisposable(domain),
    role: isRoleAccount(syntax.localPart),
    privacyRelay: isPrivacyRelay(domain),
    freeProvider: isFreeProvider(domain),
    dns,
  };
}

/** Domain DNS with the Supabase per-domain cache in front of it. */
export async function getDomainDns(domain: string): Promise<DnsResult> {
  const cached = await getCachedDomainDns(domain);
  if (cached) return cached;
  const result = await resolveDomainDns(domain);
  await saveDomainDns(result);
  return result;
}

/**
 * Bell the admins when a provider is nearly spent or is failing hard. Entirely
 * best-effort: it runs after the answer is already in hand and swallows
 * everything, so a notification problem can never fail a verification.
 */
async function raiseQuotaAlerts(chain: ChainOutcome, state: ReturnType<typeof createProviderStateStore>): Promise<void> {
  try {
    for (const attempt of chain.attempts) {
      const descriptor = getDescriptor(attempt.provider);
      if (!descriptor) continue;

      if (attempt.outcome === "auth" || attempt.outcome === "quota") {
        await maybeNotifyQuotaLow(
          attempt.provider,
          { used: descriptor.freeLimit, limit: descriptor.freeLimit, remaining: 0 },
          { reason: attempt.outcome === "auth" ? "errors" : "quota" }
        );
        continue;
      }
      if (attempt.outcome !== "ok") continue;

      const row = await state.get(attempt.provider);
      const used = row.periodKey === periodKey(attempt.provider) ? row.callsUsed : 0;
      await maybeNotifyQuotaLow(attempt.provider, { used, limit: PROVIDER_LIMITS[attempt.provider].limit });
    }
  } catch {
    /* bells are never load-bearing */
  }
}

export type VerifyOptions = {
  email: string;
  /** Call the paid provider chain. Local checks always run regardless. */
  remote?: boolean;
  /** Attribution for the stored row. */
  userId?: string | null;
  /** Set false to force a fresh check (still writes back to the cache). */
  useCache?: boolean;
};

/**
 * The engine. Local checks are always run and cost nothing; a provider is only
 * consulted when `remote` is true, the address is not already deterministically
 * dead, and the cache has nothing to offer.
 */
export async function verifyEmail(opts: VerifyOptions): Promise<VerificationResult> {
  const { email, remote = false, userId = null, useCache = true } = opts;
  const syntax = parseEmail(email);

  // 1. Bad syntax is deterministic and free — stop here, never touch DNS or a provider.
  if (!syntax.valid) {
    const local = buildLocalResult(email, null);
    const { verdict, reasons } = computeVerdict({ syntax, localPart: syntax.localPart, suggestion: local.suggestion });
    return {
      email,
      normalized: "",
      domain: syntax.domain,
      verdict,
      reasons,
      suggestion: local.suggestion,
      local,
      provider: null,
      providerStatus: null,
      localOnly: true,
      cached: false,
      verifiedAt: new Date().toISOString(),
    };
  }

  const normalized = syntax.normalized;

  // 2. Cache. A hit skips the provider entirely — this is what keeps a tiny free
  //    tier viable. A local-only cached row is NOT good enough for remote:true.
  if (useCache) {
    const cached = await getCachedVerification(normalized);
    if (cached && (!remote || cached.provider)) {
      return {
        email,
        normalized,
        domain: cached.domain,
        verdict: cached.verdict,
        reasons: cached.reasons,
        suggestion: cached.localResult?.suggestion ?? null,
        local: cached.localResult ?? buildLocalResult(email, null),
        provider: cached.provider,
        providerStatus: cached.providerStatus,
        localOnly: cached.provider === null,
        cached: true,
        verifiedAt: cached.verifiedAt,
      };
    }
  }

  // 3. DNS (per-domain cached) + the rest of the free signals.
  const dns = await getDomainDns(syntax.domain);
  const local = buildLocalResult(email, dns);
  const deterministicallyDead = dns.status === "nxdomain" || dns.status === "null_mx" || dns.status === "no_mx_no_addr";

  // 4. Provider chain — only when asked, and never for an address we already know is dead.
  let chain: ChainOutcome = { provider: null, signal: null, raw: null, attempts: [] };
  if (remote && !deterministicallyDead) {
    // Order, enablement and credentials all come from the user-managed config.
    // A DB hiccup degrades to the adapters' own env fallback rather than
    // knocking the provider chain out entirely.
    const configs = await getProviderConfigs().catch(() => null);
    const state = createProviderStateStore();
    chain = await runProviderChain(normalized, {
      // Registry order is the DEFAULT; `configs` (when present) decides the
      // real order, so a new adapter only has to be listed here once.
      providers: [verifalia, reoon, mailrook, checkMail],
      configs: configs && configs.length ? configs : null,
      state,
    });
    await raiseQuotaAlerts(chain, state);
  }

  const { verdict, reasons } = computeVerdict({
    syntax,
    localPart: syntax.localPart,
    dns: dns.status,
    disposable: local.disposable,
    role: local.role,
    privacyRelay: local.privacyRelay,
    suggestion: local.suggestion,
    provider: chain.signal,
    localOnly: chain.signal === null,
  });

  await saveVerification({
    normalizedEmail: normalized,
    domain: syntax.domain,
    localResult: local,
    provider: chain.provider,
    providerStatus: chain.signal?.status ?? null,
    providerRaw: chain.raw,
    verdict,
    reasons,
    createdBy: userId,
  });

  return {
    email,
    normalized,
    domain: syntax.domain,
    verdict,
    reasons,
    suggestion: local.suggestion,
    local,
    provider: chain.provider,
    providerStatus: chain.signal?.status ?? null,
    localOnly: chain.signal === null,
    cached: false,
    verifiedAt: new Date().toISOString(),
  };
}
