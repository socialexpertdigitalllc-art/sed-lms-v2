import { resolveDomainDns } from "./dns";
import { isDisposable, isFreeProvider, isPrivacyRelay, isRoleAccount } from "./lists";
import { runProviderChain, type ChainOutcome } from "./providers/chain";
import { reoon } from "./providers/reoon";
import { verifalia } from "./providers/verifalia";
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
export { runProviderChain } from "./providers/chain";
export { PROVIDER_LIMITS, periodKey, periodEnd, isProviderAvailable } from "./providers/quota";
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
    chain = await runProviderChain(normalized, {
      providers: [verifalia, reoon],
      state: createProviderStateStore(),
    });
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
