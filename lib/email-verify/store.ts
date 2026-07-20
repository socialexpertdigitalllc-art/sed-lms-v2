import { createAdminClient } from "@/lib/supabase/admin";
import { periodKey } from "./providers/quota";
import type { ProviderStateStore } from "./providers/types";
import type { DnsResult, LocalResult, ProviderName, ReasonCode, Verdict } from "./types";

/**
 * Supabase persistence for the verification engine. SERVER ONLY (service role).
 *
 * Every function here is best-effort: a database hiccup must degrade the answer
 * (a cache miss, an extra DNS lookup), never fail the verification.
 */

/** Address-level cache TTL — a verified mailbox rarely changes overnight. */
export const VERIFICATION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
/** Domain DNS cache TTL. */
export const DNS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type CachedVerification = {
  normalizedEmail: string;
  domain: string;
  localResult: LocalResult | null;
  provider: ProviderName | null;
  providerStatus: string | null;
  verdict: Verdict;
  reasons: ReasonCode[];
  verifiedAt: string;
};

function fresh(iso: string | null | undefined, ttlMs: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && Date.now() - t < ttlMs;
}

/** Cached verdict for an address, or null on a miss / stale row / DB error. */
export async function getCachedVerification(
  normalizedEmail: string,
  ttlMs: number = VERIFICATION_TTL_MS
): Promise<CachedVerification | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("email_verifications")
      .select("normalized_email, domain, local_result, provider, provider_status, verdict, reasons, verified_at")
      .eq("normalized_email", normalizedEmail)
      .maybeSingle();
    if (!data || !fresh(data.verified_at, ttlMs)) return null;
    return {
      normalizedEmail: data.normalized_email,
      domain: data.domain,
      localResult: (data.local_result as LocalResult) ?? null,
      provider: (data.provider as ProviderName) ?? null,
      providerStatus: data.provider_status ?? null,
      verdict: data.verdict as Verdict,
      reasons: (data.reasons ?? []) as ReasonCode[],
      verifiedAt: data.verified_at,
    };
  } catch {
    return null;
  }
}

/** Upsert on the unique normalized_email, so an address is never re-billed. */
export async function saveVerification(row: {
  normalizedEmail: string;
  domain: string;
  localResult: LocalResult;
  provider: ProviderName | null;
  providerStatus: string | null;
  providerRaw: unknown;
  verdict: Verdict;
  reasons: ReasonCode[];
  createdBy: string | null;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("email_verifications").upsert(
      {
        normalized_email: row.normalizedEmail,
        domain: row.domain,
        local_result: row.localResult,
        provider: row.provider,
        provider_status: row.providerStatus,
        provider_raw: row.providerRaw ?? null,
        verdict: row.verdict,
        reasons: row.reasons,
        verified_at: new Date().toISOString(),
        created_by: row.createdBy,
      },
      { onConflict: "normalized_email" }
    );
  } catch {
    /* cache write is best-effort */
  }
}

export async function getCachedDomainDns(domain: string, ttlMs: number = DNS_TTL_MS): Promise<DnsResult | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("email_domain_dns")
      .select("domain, has_mx, null_mx, has_addr, checked_at")
      .eq("domain", domain)
      .maybeSingle();
    if (!data || !fresh(data.checked_at, ttlMs)) return null;
    return {
      domain: data.domain,
      hasMx: data.has_mx,
      nullMx: data.null_mx,
      hasAddr: data.has_addr,
      status: data.null_mx ? "null_mx" : data.has_mx || data.has_addr ? "ok" : "no_mx_no_addr",
      checkedAt: data.checked_at,
    };
  } catch {
    return null;
  }
}

/** Only definitive answers are cached — `unknown` and `nxdomain` are transient/cheap to retry. */
export async function saveDomainDns(result: DnsResult): Promise<void> {
  if (result.status === "unknown") return;
  try {
    const admin = createAdminClient();
    await admin.from("email_domain_dns").upsert(
      {
        domain: result.domain,
        has_mx: result.hasMx,
        null_mx: result.nullMx,
        has_addr: result.hasAddr,
        checked_at: new Date().toISOString(),
      },
      { onConflict: "domain" }
    );
  } catch {
    /* best-effort */
  }
}

/** Supabase-backed implementation of the chain's quota bookkeeping. */
export function createProviderStateStore(): ProviderStateStore {
  return {
    async get(provider) {
      const fallback = { exhaustedUntil: null, periodKey: periodKey(provider), callsUsed: 0 };
      try {
        const admin = createAdminClient();
        const { data } = await admin
          .from("email_verify_provider_state")
          .select("provider, exhausted_until, period_key, calls_used")
          .eq("provider", provider)
          .maybeSingle();
        if (!data) return fallback;
        return {
          exhaustedUntil: data.exhausted_until ? new Date(data.exhausted_until) : null,
          periodKey: data.period_key ?? "",
          callsUsed: data.calls_used ?? 0,
        };
      } catch {
        return fallback;
      }
    },

    async recordCall(provider, key) {
      try {
        const admin = createAdminClient();
        const { data } = await admin
          .from("email_verify_provider_state")
          .select("period_key, calls_used")
          .eq("provider", provider)
          .maybeSingle();
        const samePeriod = data?.period_key === key;
        await admin.from("email_verify_provider_state").upsert(
          {
            provider,
            period_key: key,
            calls_used: samePeriod ? (data?.calls_used ?? 0) + 1 : 1,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "provider" }
        );
      } catch {
        /* best-effort */
      }
    },

    async markExhausted(provider, until, message) {
      try {
        const admin = createAdminClient();
        await admin.from("email_verify_provider_state").upsert(
          {
            provider,
            exhausted_until: until.toISOString(),
            last_error: message.slice(0, 500),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "provider" }
        );
      } catch {
        /* best-effort */
      }
    },

    async recordError(provider, message) {
      try {
        const admin = createAdminClient();
        await admin.from("email_verify_provider_state").upsert(
          { provider, last_error: message.slice(0, 500), updated_at: new Date().toISOString() },
          { onConflict: "provider" }
        );
      } catch {
        /* best-effort */
      }
    },
  };
}
