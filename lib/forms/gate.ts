// lib/forms/gate.ts
import type { FormSpamReason } from "@/lib/forms/types";

export const IP_LIMIT_PER_MINUTE = 10;
const WINDOW_MS = 60_000;

/** Hostname of the calling page: Origin header, else Referer. Null when unknown. */
export function originHost(origin: string | null, referer: string | null): string | null {
  for (const candidate of [origin, referer]) {
    if (!candidate || candidate === "null") continue;
    try { return new URL(candidate).hostname.toLowerCase(); } catch { /* not a URL */ }
  }
  return null;
}

/** Empty list = any origin. Entries are hostnames; `*.example.com` also matches the apex. */
export function originAllowed(host: string | null, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  if (!host) return false;
  return allowed.some((entry) => {
    const e = entry.trim().toLowerCase();
    if (!e) return false;
    if (e.startsWith("*.")) { const apex = e.slice(2); return host === apex || host.endsWith("." + apex); }
    return host === e;
  });
}

export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) { const first = xff.split(",")[0]?.trim(); if (first) return first; }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

// Per-process sliding window. Prod is one pm2 process, so this is the real
// limit there; the daily limit below is the durable, cross-restart one.
const hits = new Map<string, number[]>();
let lastSweep = 0;

export function ipRateAllowed(ip: string, now: () => number = Date.now): boolean {
  const t = now();
  const list = (hits.get(ip) ?? []).filter((ts) => t - ts < WINDOW_MS);
  if (list.length >= IP_LIMIT_PER_MINUTE) { hits.set(ip, list); return false; }
  list.push(t);
  hits.set(ip, list);
  // Sweep at most once per window: an unthrottled full-map scan above the
  // threshold would make every request pay O(map) exactly when a
  // distinct-IP flood is inflating the map. If a flood outruns the sweep,
  // drop the state entirely — losing 60s of rate memory under attack is
  // cheaper than unbounded growth, and the durable daily limit still holds.
  if (hits.size > 10_000 && t - lastSweep >= WINDOW_MS) {
    lastSweep = t;
    for (const [k, v] of hits) if (v.every((ts) => t - ts >= WINDOW_MS)) hits.delete(k);
    if (hits.size > 50_000) hits.clear();
  }
  return true;
}

/** Test hook. */
export function resetIpRate(): void { hits.clear(); lastSweep = 0; }

export type GateVerdict = { ok: true } | { ok: false; reason: FormSpamReason; status: 200 | 403 | 429 };

/** Gate order: origin → per-IP → honeypot → daily. The per-IP check runs
 *  BEFORE the honeypot so a honeypot-flooding bot burns rate slots and gets
 *  429'd after the limit, instead of unlimited fake-200s (each of which
 *  costs a DB insert). The first hits per window still get the fake 200,
 *  so the honeypot stays invisible to a casual bot. */
export function gateSubmission(input: {
  originHost: string | null;
  endpoint: { allowed_origins: string[]; daily_limit: number };
  honeypot: string;
  ip: string;
  todayCount: number;
  now?: () => number;
}): GateVerdict {
  if (!originAllowed(input.originHost, input.endpoint.allowed_origins)) return { ok: false, reason: "origin", status: 403 };
  if (!ipRateAllowed(input.ip, input.now)) return { ok: false, reason: "rate_ip", status: 429 };
  if (input.honeypot.trim()) return { ok: false, reason: "honeypot", status: 200 };
  if (input.todayCount >= input.endpoint.daily_limit) return { ok: false, reason: "rate_daily", status: 429 };
  return { ok: true };
}

/** UTC midnight ISO for the daily-limit count. */
export function utcDayStart(now: () => number = Date.now): string {
  const d = new Date(now());
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}
