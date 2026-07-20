import { createAdminClient } from "@/lib/supabase/admin";
import { getProviderConfigs } from "./config";
import { PROVIDER_REGISTRY, getDescriptor, hasCompleteCredentials, recommendedPriority } from "./registry";
import { BASE_URL as VERIFALIA_BASE_URL, getVerifaliaCredentials, verifaliaAuthHeader } from "./providers/verifalia";
import { getReoonKey } from "./providers/reoon";
import { periodEnd, periodKey } from "./providers/quota";
import type { ProviderCredentials } from "./providers/types";
import type { ProviderName } from "./types";

/**
 * Live remaining quota per provider.
 *
 * Both vendors publish an authoritative balance endpoint (verified against the
 * live APIs on 2026-07-20):
 *
 *   Verifalia  GET {BASE}/credits/balance
 *              → {"creditPacks":0,"freeCredits":22,"freeCreditsResetIn":"13:20:05"}
 *   Reoon      GET https://emailverifier.reoon.com/api/v1/check-account-balance/?key=…
 *              → {"api_status":"active","remaining_daily_credits":18,
 *                 "remaining_instant_credits":100,"status":"success"}
 *
 * Neither costs a verification credit, which is why the settings page and the
 * credential test both go through here rather than verifying a throwaway
 * address. The answer is cached ~60s on the provider-state row so a settings
 * page cannot hammer the vendor, and NOTHING here ever throws: on failure we
 * report `source: "counter"` with `limit - calls_used` and an `error` string.
 */

export const BALANCE_CACHE_MS = 60_000;
const BALANCE_TIMEOUT_MS = 8000;
const REOON_BALANCE_URL =
  process.env.REOON_BALANCE_URL || "https://emailverifier.reoon.com/api/v1/check-account-balance/";

export interface ProviderQuota {
  key: string;
  source: "provider" | "counter";
  /** Calls we believe are still available, or null when genuinely unknown. */
  remaining: number | null;
  /** Our free-tier allowance for the period (from the registry). */
  limit: number;
  period: "day" | "month";
  /** ISO instant at which the current period rolls over. */
  periodEnd: string;
  checkedAt: string;
  /** Present only when the vendor lookup failed and we fell back. */
  error?: string;
}

/* ------------------------------------------------------------------ parsers */

/** Verifalia: purchased packs + daily free credits. Null when unparseable. */
export function parseVerifaliaBalance(body: unknown): number | null {
  const b = body as { creditPacks?: unknown; freeCredits?: unknown } | null;
  if (!b || typeof b !== "object") return null;
  const packs = typeof b.creditPacks === "number" ? b.creditPacks : null;
  const free = typeof b.freeCredits === "number" ? b.freeCredits : null;
  if (packs === null && free === null) return null;
  return (packs ?? 0) + (free ?? 0);
}

/**
 * Reoon meters BOTH a daily allowance and an instant-credit pool, and a single
 * verification needs one of each — so the smaller number is what we can
 * actually spend. Pessimistic on purpose.
 */
export function parseReoonBalance(body: unknown): number | null {
  const b = body as { remaining_daily_credits?: unknown; remaining_instant_credits?: unknown } | null;
  if (!b || typeof b !== "object") return null;
  const parts = [b.remaining_daily_credits, b.remaining_instant_credits].filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v)
  );
  if (!parts.length) return null;
  return Math.min(...parts);
}

/* ------------------------------------------------------------------- vendor */

export type BalanceLookup = { ok: true; remaining: number | null } | { ok: false; error: string };

async function fetchJson(url: string, headers: Record<string, string>): Promise<Response> {
  return fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS) });
}

export async function fetchVerifaliaBalance(credentials?: ProviderCredentials | null): Promise<BalanceLookup> {
  const creds = getVerifaliaCredentials(credentials);
  if (!creds) return { ok: false, error: "Verifalia credentials not configured" };
  try {
    const res = await fetchJson(`${VERIFALIA_BASE_URL}/credits/balance`, {
      Authorization: verifaliaAuthHeader(creds),
      Accept: "application/json",
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: "Verifalia rejected the credentials" };
    if (!res.ok) return { ok: false, error: `Verifalia HTTP ${res.status}` };
    const body = await res.json().catch(() => null);
    return { ok: true, remaining: parseVerifaliaBalance(body) };
  } catch (err) {
    // Never echo the URL or the header — only the shape of the failure.
    return { ok: false, error: err instanceof Error ? err.name : "Verifalia request failed" };
  }
}

export async function fetchReoonBalance(credentials?: ProviderCredentials | null): Promise<BalanceLookup> {
  const key = getReoonKey(credentials);
  if (!key) return { ok: false, error: "Reoon API key not configured" };
  try {
    const res = await fetchJson(`${REOON_BALANCE_URL}?key=${encodeURIComponent(key)}`, {
      Accept: "application/json",
    });
    // The URL carries the key: the status code is all we are allowed to surface.
    if (res.status === 401 || res.status === 403) return { ok: false, error: "Reoon rejected the API key" };
    if (!res.ok) return { ok: false, error: `Reoon HTTP ${res.status}` };
    const body = (await res.json().catch(() => null)) as { status?: string; reason?: string } | null;
    if (body?.status === "error") return { ok: false, error: "Reoon rejected the API key" };
    return { ok: true, remaining: parseReoonBalance(body) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.name : "Reoon request failed" };
  }
}

/** Vendor balance lookup for any registry provider, or null when it has none. */
export async function fetchProviderBalance(
  key: string,
  credentials?: ProviderCredentials | null
): Promise<BalanceLookup | null> {
  if (key === "verifalia") return fetchVerifaliaBalance(credentials);
  if (key === "reoon") return fetchReoonBalance(credentials);
  return null;
}

/* -------------------------------------------------------------------- cache */

type StateRow = {
  period_key: string | null;
  calls_used: number | null;
  balance_remaining: number | null;
  balance_checked_at: string | null;
};

async function readState(key: string): Promise<StateRow | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("email_verify_provider_state")
      .select("period_key, calls_used, balance_remaining, balance_checked_at")
      .eq("provider", key)
      .maybeSingle();
    return (data ?? null) as StateRow | null;
  } catch {
    return null;
  }
}

async function writeBalance(key: string, remaining: number | null, at: string): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin
      .from("email_verify_provider_state")
      .upsert(
        { provider: key, balance_remaining: remaining, balance_checked_at: at, updated_at: at },
        { onConflict: "provider" }
      );
  } catch {
    /* the cache write is best-effort — a miss only costs one extra lookup */
  }
}

/** `limit - calls_used` for the current period; the fallback answer. */
export function counterRemaining(limit: number, state: { periodKey: string; callsUsed: number } | null, key: string, now: Date): number {
  if (!state || state.periodKey !== periodKey(key as ProviderName, now)) return limit;
  return Math.max(0, limit - state.callsUsed);
}

export function isBalanceFresh(checkedAt: string | null, now: Date, ttlMs = BALANCE_CACHE_MS): boolean {
  if (!checkedAt) return false;
  const t = Date.parse(checkedAt);
  return Number.isFinite(t) && now.getTime() - t < ttlMs;
}

/* ---------------------------------------------------------------- public API */

/**
 * Remaining quota for one provider. Prefers the vendor's own number, falls back
 * to our counter, and never throws.
 */
export async function getProviderQuota(
  key: string,
  opts: { force?: boolean; now?: Date } = {}
): Promise<ProviderQuota> {
  const now = opts.now ?? new Date();
  const descriptor = getDescriptor(key);
  const limit = descriptor?.freeLimit ?? 0;
  const period = descriptor?.period ?? "day";
  const base = {
    key,
    limit,
    period,
    periodEnd: periodEnd(key as ProviderName, now).toISOString(),
    checkedAt: now.toISOString(),
  };

  const state = await readState(key);
  const counter = counterRemaining(limit, state ? { periodKey: state.period_key ?? "", callsUsed: state.calls_used ?? 0 } : null, key, now);

  if (!descriptor) return { ...base, source: "counter", remaining: counter, error: "Unknown provider" };

  // Serve the cached vendor number when it is still warm.
  if (!opts.force && descriptor.supportsBalance && isBalanceFresh(state?.balance_checked_at ?? null, now)) {
    return {
      ...base,
      source: "provider",
      remaining: state?.balance_remaining ?? null,
      checkedAt: state?.balance_checked_at ?? base.checkedAt,
    };
  }

  const config = (await getProviderConfigs().catch(() => [])).find((c) => c.key === key);
  if (!hasCompleteCredentials(descriptor, config?.credentials)) {
    return { ...base, source: "counter", remaining: counter, error: "Not configured" };
  }

  if (!descriptor.supportsBalance) return { ...base, source: "counter", remaining: counter };

  const lookup = await fetchProviderBalance(key, config?.credentials);
  if (!lookup || !lookup.ok) {
    return { ...base, source: "counter", remaining: counter, error: lookup?.ok === false ? lookup.error : "No balance endpoint" };
  }

  await writeBalance(key, lookup.remaining, base.checkedAt);
  return { ...base, source: "provider", remaining: lookup.remaining };
}

/** Quota for every registry provider, in configured priority order. */
export async function getAllProviderQuotas(): Promise<ProviderQuota[]> {
  const configs = await getProviderConfigs().catch(() => []);
  const order = new Map(configs.map((c) => [c.key, c.priority]));
  const keys = PROVIDER_REGISTRY.map((d) => d.key).sort(
    (a, b) => (order.get(a) ?? recommendedPriority(a)) - (order.get(b) ?? recommendedPriority(b)) || a.localeCompare(b)
  );
  return Promise.all(keys.map((k) => getProviderQuota(k)));
}
