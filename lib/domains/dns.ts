// lib/domains/dns.ts — the DNS recipe for a Cloudflare-registered client domain,
// read off the 16 domains set up by hand (2026-10-02):
//   A     <domain>      -> the client hosting server's IP, proxy OFF
//   CNAME www.<domain>  -> <domain>,                       proxy OFF
// Proxy off keeps Hostinger's free lifetime SSL working (verified active on
// Cloudflare-DNS sites). Everything else in the zone (MX, TXT, other
// subdomains) is left alone.
import type { DnsRecord, DnsRecordInput } from "@/lib/cloudflare/client";

/** The server behind the client-sites hosting plan (u447231526). Override with
 *  HOSTINGER_CLIENT_SITES_IP if the plan ever moves servers — the pipeline
 *  confirms the server hosts the site before any record is written. */
export const DEFAULT_CLIENT_SITES_IP = "76.13.203.71";

export function clientSitesIp(): string {
  return (process.env.HOSTINGER_CLIENT_SITES_IP ?? "").trim() || DEFAULT_CLIENT_SITES_IP;
}

export interface DnsPlan {
  create: DnsRecordInput[];
  update: { id: string; rec: DnsRecordInput; from: string }[];
  remove: { id: string; what: string }[];
}

const RECORD_COMMENT = "SED LMS: points the client site at Hostinger";

/**
 * What must change so the zone matches the recipe. Pure — tested.
 *  - apex: exactly one A to `ip` (unproxied); other A/AAAA/CNAME at the apex
 *    are removed (they would send some visitors elsewhere).
 *  - www: a CNAME to the apex (unproxied); A/AAAA at www are removed, since a
 *    CNAME cannot coexist with them.
 */
export function planDns(domain: string, ip: string, records: DnsRecord[]): DnsPlan {
  const apex = domain.toLowerCase();
  const www = `www.${apex}`;
  const plan: DnsPlan = { create: [], update: [], remove: [] };
  const at = (name: string) => records.filter((r) => r.name.toLowerCase() === name);

  // apex
  const apexRecs = at(apex).filter((r) => ["A", "AAAA", "CNAME"].includes(r.type));
  const keep = apexRecs.find((r) => r.type === "A" && r.content === ip);
  const reusable = keep ?? apexRecs.find((r) => r.type === "A");
  const wantApex: DnsRecordInput = { type: "A", name: apex, content: ip, proxied: false, comment: RECORD_COMMENT };
  if (!reusable) plan.create.push(wantApex);
  else if (reusable.content !== ip || reusable.proxied) {
    plan.update.push({ id: reusable.id, rec: wantApex, from: `${reusable.type} ${reusable.content}${reusable.proxied ? " (proxied)" : ""}` });
  }
  for (const r of apexRecs) {
    if (r.id !== reusable?.id) plan.remove.push({ id: r.id, what: `${r.type} ${r.name} -> ${r.content}` });
  }

  // www
  const wwwRecs = at(www).filter((r) => ["A", "AAAA", "CNAME"].includes(r.type));
  const cname = wwwRecs.find((r) => r.type === "CNAME");
  const wantWww: DnsRecordInput = { type: "CNAME", name: www, content: apex, proxied: false, comment: RECORD_COMMENT };
  if (!cname) plan.create.push(wantWww);
  else if (cname.content.toLowerCase().replace(/\.$/, "") !== apex || cname.proxied) {
    plan.update.push({ id: cname.id, rec: wantWww, from: `CNAME ${cname.content}${cname.proxied ? " (proxied)" : ""}` });
  }
  for (const r of wwwRecs) {
    if (r.id !== cname?.id) plan.remove.push({ id: r.id, what: `${r.type} ${r.name} -> ${r.content}` });
  }
  return plan;
}

export function planIsEmpty(p: DnsPlan): boolean {
  return p.create.length === 0 && p.update.length === 0 && p.remove.length === 0;
}

/** Public A records via Cloudflare's DNS-over-HTTPS resolver; null = no answer. */
export async function lookupA(name: string): Promise<string[] | null> {
  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=A`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { Answer?: { type: number; data: string }[] };
    return (j.Answer ?? []).filter((a) => a.type === 1).map((a) => a.data);
  } catch {
    return null;
  }
}

/** Hostinger's "domain parked" page (verified 2026-10-02 on two parked
 *  portfolio domains). Hostinger's nameservers (dns-parking.com) serve EVERY
 *  domain on its DNS, hosted or not, so they say nothing on their own. */
export const HOSTINGER_PARKING_IPS = ["2.57.91.91"];

/**
 * Is a domain that Hostinger does NOT host in use somewhere else? "free" when
 * neither it nor its www points anywhere, or only at Hostinger's parking page;
 * "in_use" when either points at a server — a live site we must not take
 * over (an unknown parking address errs this way too); null when DNS could
 * not be read.
 */
export async function dnsUse(domain: string): Promise<"free" | "in_use" | null> {
  const [apex, www] = await Promise.all([lookupA(domain), lookupA(`www.${domain}`)]);
  if (apex === null || www === null) return null;
  return [...apex, ...www].every((ip) => HOSTINGER_PARKING_IPS.includes(ip)) ? "free" : "in_use";
}
