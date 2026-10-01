// lib/domains/health.ts — is the client's site actually up? Each check reads
// public DNS, the TLS certificate and an HTTPS request, and boils them down to
// one state:
//   up         the site answers over HTTPS (2xx/3xx) with a valid certificate
//   down       no answer, an error page (4xx/5xx), or a timeout
//   ssl_error  the certificate is expired, missing or for another name
//   parked     the domain only points at Hostinger's parking page
//   no_dns     the domain points nowhere
// The latest result sits on the row; every check is kept 90 days in
// client_domain_checks (uptime, response times). Admin hears about an outage
// once it is CONFIRMED — two failed checks in a row — never on a single blip.
import { connect } from "node:tls";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notify as realNotify } from "@/lib/notifications/notify";
import { HOSTINGER_PARKING_IPS, lookupA } from "./dns";
import type { ClientDomainRow, DomainHealth, HealthState } from "./types";

export interface SiteProbe {
  /** null = the lookup itself failed (our side) */
  dns: { apex: string[] | null; www: string[] | null };
  /** null = nothing answered on port 443 */
  tls: { authorized: boolean; error: string | null; validTo: string | null; issuer: string | null } | null;
  http: { status: number; finalUrl: string; ms: number } | null;
  httpError: string | null;
}

const TLS_TIMEOUT_MS = 10_000;
const HTTP_TIMEOUT_MS = 15_000;
/** One quick second try on a connection-level failure: a single dropped
 *  handshake (seen live on a healthy site) must not read as an outage. */
const RETRY_AFTER_MS = 1_500;
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function tlsProbe(host: string): Promise<SiteProbe["tls"]> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: SiteProbe["tls"]) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(v);
    };
    const socket = connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: TLS_TIMEOUT_MS }, () => {
      const cert = socket.getPeerCertificate();
      const validTo = cert && cert.valid_to ? new Date(cert.valid_to) : null;
      const issuer = cert?.issuer ? (cert.issuer.O as string | undefined) ?? (cert.issuer.CN as string | undefined) ?? null : null;
      finish({
        authorized: socket.authorized,
        error: socket.authorized ? null : String(socket.authorizationError ?? "certificate not trusted"),
        validTo: validTo && !Number.isNaN(validTo.getTime()) ? validTo.toISOString() : null,
        issuer: issuer ?? null,
      });
    });
    socket.on("timeout", () => finish(null));
    socket.on("error", () => finish(null));
  });
}

/** Read the site as a visitor would. Never throws. */
export async function probeSite(domain: string): Promise<SiteProbe> {
  const [apex, www] = await Promise.all([lookupA(domain), lookupA(`www.${domain}`)]);
  const probe: SiteProbe = { dns: { apex, www }, tls: null, http: null, httpError: null };
  const host = apex && apex.length ? domain : www && www.length ? `www.${domain}` : null;
  if (!host) return probe;
  const ips = [...(apex ?? []), ...(www ?? [])];
  if (ips.every((ip) => HOSTINGER_PARKING_IPS.includes(ip))) return probe;
  probe.tls = (await tlsProbe(host)) ?? (await pause(RETRY_AFTER_MS).then(() => tlsProbe(host)));
  if (!probe.tls || !probe.tls.authorized) return probe;
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(`https://${host}/`, {
        redirect: "follow",
        headers: { "User-Agent": "SED-LMS-SiteCheck/1.0" },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      probe.http = { status: res.status, finalUrl: res.url, ms: Date.now() - started };
      probe.httpError = null;
      await res.body?.cancel().catch(() => {});
      break;
    } catch (e) {
      probe.httpError = e instanceof Error ? (e.name === "TimeoutError" ? "timed out" : e.message) : "no answer";
      if (attempt === 0) await pause(RETRY_AFTER_MS);
    }
  }
  return probe;
}

function sslWords(error: string | null): string {
  const e = (error ?? "").toUpperCase();
  if (e.includes("EXPIRED")) return "The SSL certificate has expired";
  if (e.includes("ALTNAME") || e.includes("HOSTNAME") || e.includes("MISMATCH")) return "The SSL certificate is for a different site";
  if (e.includes("SELF_SIGNED") || e.includes("SELF-SIGNED")) return "The SSL certificate is self-signed";
  if (e.includes("NOT_YET_VALID")) return "The SSL certificate isn't valid yet";
  return "The SSL certificate isn't trusted";
}

/**
 * Pure: a probe → the domain's health, carrying the streak and the time the
 * current state began. null = inconclusive (our DNS lookup failed) — record
 * nothing and try again later. Tested.
 */
export function classifyHealth(p: SiteProbe, prev: DomainHealth | null, now: Date): DomainHealth | null {
  if (p.dns.apex === null || p.dns.www === null) return null;
  const ips = [...p.dns.apex, ...p.dns.www];
  let state: HealthState;
  let summary: string;
  if (ips.length === 0) {
    state = "no_dns";
    summary = "The domain doesn't point anywhere";
  } else if (ips.every((ip) => HOSTINGER_PARKING_IPS.includes(ip))) {
    state = "parked";
    summary = "The domain shows Hostinger's parking page";
  } else if (!p.tls) {
    state = "down";
    summary = "Nothing answers on HTTPS";
  } else if (!p.tls.authorized) {
    state = "ssl_error";
    summary = sslWords(p.tls.error);
  } else if (!p.http) {
    state = "down";
    summary = `The site didn't answer (${p.httpError ?? "no response"})`;
  } else if (p.http.status >= 200 && p.http.status < 400) {
    state = "up";
    summary = `Up — answered in ${p.http.ms} ms`;
  } else {
    state = "down";
    summary =
      p.http.status === 403
        ? "HTTP 403 — the server isn't serving this site"
        : p.http.status >= 500
          ? `HTTP ${p.http.status} — the server is failing`
          : `HTTP ${p.http.status}`;
  }
  const failing = state === "down" || state === "ssl_error";
  const prevFailing = prev ? prev.state === "down" || prev.state === "ssl_error" : false;
  return {
    state,
    summary,
    http_status: p.http?.status ?? null,
    final_url: p.http?.finalUrl ?? null,
    ms: p.http?.ms ?? null,
    ssl: p.tls ? { valid: p.tls.authorized, valid_to: p.tls.validTo, issuer: p.tls.issuer, error: p.tls.error } : null,
    dns: { apex: p.dns.apex, www: p.dns.www },
    consecutive_failures: failing ? (prevFailing ? (prev?.consecutive_failures ?? 0) + 1 : 1) : 0,
    since: prev && prev.state === state ? prev.since : now.toISOString(),
  };
}

/** Sites we expect to be up: linked/hand-made domains still registered. */
function expectsSite(row: Pick<ClientDomainRow, "status" | "registrar_status">): boolean {
  return ["live", "connected", "waiting_for_site"].includes(row.status) && row.registrar_status !== "expired" && row.registrar_status !== "missing";
}

type HealthRow = Pick<ClientDomainRow, "id" | "domain" | "status" | "registrar_status" | "lead_id" | "health_state" | "health" | "health_checked_at">;

export interface HealthDeps {
  probe?: (domain: string) => Promise<SiteProbe>;
  notify?: typeof realNotify;
  now?: Date;
}

/** Check one domain now, store the result and its history row, alert on a confirmed outage. */
export async function checkDomainHealth(admin: SupabaseClient, row: HealthRow, deps: HealthDeps = {}): Promise<DomainHealth | null> {
  const now = deps.now ?? new Date();
  const probe = await (deps.probe ?? probeSite)(row.domain);
  const prev = row.health_state ? (row.health as DomainHealth) : null;
  const h = classifyHealth(probe, prev, now);
  if (!h) return null;
  await admin
    .from("client_domains")
    .update({ health_state: h.state, health: h, health_checked_at: now.toISOString() })
    .eq("id", row.id);
  await admin.from("client_domain_checks").insert({
    domain_id: row.id,
    checked_at: now.toISOString(),
    state: h.state,
    http_status: h.http_status,
    ms: h.ms,
    ssl_valid_to: h.ssl?.valid_to ?? null,
    error: h.state === "up" ? null : h.summary,
  });
  if ((h.state === "down" || h.state === "ssl_error") && h.consecutive_failures === 2 && expectsSite(row)) {
    await (deps.notify ?? realNotify)(
      "domain_site_down",
      { leadId: row.lead_id, lead: null },
      {
        title: h.state === "ssl_error" ? `SSL problem: ${row.domain}` : `Site down: ${row.domain}`,
        body: `${h.summary}. Checked twice since ${new Date(h.since).toUTCString()}.`,
        dedupKey: `domain_site_down:${row.id}:${h.since}`,
        targetUrl: `/domains/${row.id}`,
      },
    ).catch(() => {});
  }
  return h;
}

const HOUR_MS = 3_600_000;
export const HEALTH_STALE_MS = 6 * HOUR_MS;
/** A first failure is re-checked this soon, so an outage is confirmed (or not) quickly. */
export const HEALTH_RECHECK_MS = 5 * 60_000;
const RETENTION_DAYS = 90;

/** Pure: which rows a sweep should check now, most urgent first. Tested. */
export function dueForCheck(rows: HealthRow[], now: Date, limit: number): HealthRow[] {
  const t = now.getTime();
  const age = (r: HealthRow) => (r.health_checked_at ? t - Date.parse(r.health_checked_at) : Infinity);
  const recheck = (r: HealthRow) => ((r.health as DomainHealth)?.consecutive_failures ?? 0) === 1 && age(r) >= HEALTH_RECHECK_MS;
  return rows
    .filter((r) => recheck(r) || age(r) >= HEALTH_STALE_MS)
    .sort((a, b) => Number(recheck(b)) - Number(recheck(a)) || age(b) - age(a))
    .slice(0, limit);
}

/**
 * The background health round: check the most overdue domains (a confirmation
 * re-check first), a few at a time, within a time budget; prune history older
 * than 90 days.
 */
export async function healthSweep(
  admin: SupabaseClient,
  opts: HealthDeps & { budgetMs?: number; limit?: number; concurrency?: number } = {},
): Promise<{ checked: number }> {
  const now = opts.now ?? new Date();
  const deadline = Date.now() + (opts.budgetMs ?? 45_000);
  const { data } = await admin
    .from("client_domains")
    .select("id, domain, status, registrar_status, lead_id, health_state, health, health_checked_at")
    .not("status", "in", "(purchasing,failed)");
  const rows = ((data ?? []) as HealthRow[]).filter((r) => r.registrar_status !== "missing");
  const queue = dueForCheck(rows, now, opts.limit ?? 12);
  let checked = 0;
  const worker = async () => {
    while (queue.length && Date.now() < deadline) {
      const row = queue.shift()!;
      const h = await checkDomainHealth(admin, row, opts).catch(() => null);
      if (h) checked++;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, worker));
  await admin
    .from("client_domain_checks")
    .delete()
    .lt("checked_at", new Date(now.getTime() - RETENTION_DAYS * 24 * HOUR_MS).toISOString());
  return { checked };
}
