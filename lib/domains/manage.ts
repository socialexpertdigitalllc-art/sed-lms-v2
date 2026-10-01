// lib/domains/manage.ts — everything that can be done to a domain from the
// dashboard, on whichever registrar holds it: renew, auto-renew, transfer lock,
// WHOIS privacy, nameservers, forwarding, the transfer code, moving it to a
// client's Hostinger account, and its DNS records. Routes check permissions;
// this module talks to the registrar and keeps the row and the activity log in
// step. What a registrar's API cannot do (Cloudflare can't renew, give a
// transfer code or transfer out) comes back as a refusal WITH a link to the
// registrar page where it is done.
import type { SupabaseClient } from "@supabase/supabase-js";
import * as cf from "@/lib/cloudflare/client";
import * as hg from "@/lib/hostinger/client";
import type { HostingerZoneRecord } from "@/lib/hostinger/client";
import { registrarDashboardUrl, type ClientDomainRow, type DomainDetails } from "./types";

export type ManageResult<T = object> = ({ ok: true } & T) | { ok: false; status: number; error: string; link?: string };

type Row = Pick<
  ClientDomainRow,
  "id" | "domain" | "registrar" | "details" | "cf_zone_id" | "hostinger_subscription_id" | "registrar_status" | "renewal_cost_cents" | "currency"
>;

const refuse = (status: number, error: string, link?: string): { ok: false; status: number; error: string; link?: string } =>
  link ? { ok: false, status, error, link } : { ok: false, status, error };

async function log(admin: SupabaseClient, actorId: string | null, row: Row, action: string, value: Record<string, unknown>) {
  await admin.from("activity_log").insert({
    user_id: actorId,
    action,
    entity_type: "client_domain",
    entity_id: row.id,
    new_value: { domain: row.domain, ...value },
  });
}

async function saveDetails(admin: SupabaseClient, row: Row, patch: Partial<DomainDetails>) {
  const details = { ...(row.details ?? {}), ...patch };
  await admin.from("client_domains").update({ details, updated_at: new Date().toISOString() }).eq("id", row.id);
  return details;
}

// ---------------------------------------------------------------------------
// registrar settings

export interface RegistrarSettings {
  registrar: ClientDomainRow["registrar"];
  locked: boolean | null;
  lockable: boolean;
  privacy: boolean | null;
  privacyAllowed: boolean;
  nameservers: string[];
  nameserversEditable: boolean;
  forwarding: hg.HostingerForwarding | null;
  forwardingSupported: boolean;
  move: { status: string; createdAt: string | null } | null;
  moveSupported: boolean;
  authCodeSupported: boolean;
  renewSupported: boolean;
  dashboardUrl: string;
  /** The registrar's own note on the domain, if any. */
  message: string | null;
}

/** Live settings from the registrar; the row keeps a snapshot for lists and analytics. */
export async function readRegistrarSettings(admin: SupabaseClient, row: Row): Promise<ManageResult<{ settings: RegistrarSettings }>> {
  const dashboardUrl = registrarDashboardUrl(row);
  if (row.registrar === "hostinger") {
    const [details, forwarding, move] = await Promise.all([
      hg.getHostingerDomainDetails(row.domain),
      hg.getHostingerForwarding(row.domain),
      hg.getHostingerDomainMove(row.domain),
    ]);
    if (!details) return refuse(502, "Could not read the domain from Hostinger");
    const settings: RegistrarSettings = {
      registrar: "hostinger",
      locked: details.locked,
      lockable: details.lockable !== false,
      privacy: details.privacy,
      privacyAllowed: details.privacyAllowed !== false,
      nameservers: details.nameservers,
      nameserversEditable: true,
      forwarding: forwarding === "error" ? null : forwarding,
      forwardingSupported: true,
      move: move === "error" ? null : move,
      moveSupported: true,
      authCodeSupported: true,
      renewSupported: true,
      dashboardUrl,
      message: details.message,
    };
    // an outgoing move: keep its status current; none in progress any more
    // (cancelled or declined — a finished one takes the domain off the account)
    const moveSnapshot =
      move === "error"
        ? undefined
        : move
          ? { email: row.details?.move?.email ?? "", started_at: row.details?.move?.started_at ?? move.createdAt ?? new Date().toISOString(), status: move.status }
          : null;
    await saveDetails(admin, row, {
      locked: details.locked,
      privacy: details.privacy,
      nameservers: details.nameservers,
      settings_at: new Date().toISOString(),
      ...(moveSnapshot === undefined ? {} : { move: moveSnapshot }),
    });
    return { ok: true, settings };
  }
  const [reg, zone] = await Promise.all([cf.getRegistration(row.domain), cf.findZone(row.domain)]);
  if (!reg) return refuse(502, "Could not read the domain from Cloudflare");
  const nameservers = zone && zone !== "error" ? (zone.name_servers ?? []) : [];
  const settings: RegistrarSettings = {
    registrar: "cloudflare",
    locked: typeof reg.locked === "boolean" ? reg.locked : null,
    lockable: true,
    privacy: reg.privacy_mode ? reg.privacy_mode !== "off" : null,
    privacyAllowed: true,
    nameservers,
    // a Cloudflare Registrar domain must use Cloudflare's nameservers
    nameserversEditable: false,
    forwarding: null,
    forwardingSupported: false,
    move: null,
    moveSupported: false,
    authCodeSupported: false,
    renewSupported: false,
    dashboardUrl,
    message: null,
  };
  await saveDetails(admin, row, { locked: settings.locked, privacy: settings.privacy, nameservers, settings_at: new Date().toISOString() });
  return { ok: true, settings };
}

/** Normalize and check a nameserver list (2–4 hostnames). Pure; tested. */
export function cleanNameservers(input: string[]): string[] | null {
  const ns = input.map((n) => n.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean);
  const host = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/;
  if (ns.length < 2 || ns.length > 4 || !ns.every((n) => host.test(n)) || new Set(ns).size !== ns.length) return null;
  return ns;
}

export async function updateRegistrarSettings(
  admin: SupabaseClient,
  row: Row,
  patch: { locked?: boolean; privacy?: boolean; nameservers?: string[] },
  actorId: string,
): Promise<ManageResult> {
  const link = registrarDashboardUrl(row);
  if (patch.nameservers !== undefined) {
    if (row.registrar === "cloudflare") {
      return refuse(422, "A domain registered on Cloudflare must use Cloudflare's nameservers — edit its DNS records instead.");
    }
    const ns = cleanNameservers(patch.nameservers);
    if (!ns) return refuse(400, "Give 2 to 4 different nameserver hostnames, e.g. ns1.example.com");
    const r = await hg.setHostingerNameservers(row.domain, ns);
    if (!r.ok) return refuse(502, `Hostinger: ${r.message}`, link);
    await saveDetails(admin, row, { nameservers: ns });
    await log(admin, actorId, row, "domain.nameservers_changed", { nameservers: ns });
  }
  if (patch.locked !== undefined) {
    const r =
      row.registrar === "hostinger"
        ? await hg.setHostingerDomainLock(row.domain, patch.locked)
        : await cf.updateRegistration(row.domain, { locked: patch.locked });
    if (!r.ok) return refuse(502, `${row.registrar === "hostinger" ? "Hostinger" : "Cloudflare"}: ${r.message ?? "could not change the lock"}`, link);
    await saveDetails(admin, row, { locked: patch.locked });
    await log(admin, actorId, row, patch.locked ? "domain.locked" : "domain.unlocked", {});
  }
  if (patch.privacy !== undefined) {
    const r =
      row.registrar === "hostinger"
        ? await hg.setHostingerPrivacy(row.domain, patch.privacy)
        : await cf.updateRegistration(row.domain, { privacy_mode: patch.privacy ? "redaction" : "off" });
    if (!r.ok) return refuse(502, `${row.registrar === "hostinger" ? "Hostinger" : "Cloudflare"}: ${r.message ?? "could not change privacy"}`, link);
    await saveDetails(admin, row, { privacy: patch.privacy });
    await log(admin, actorId, row, patch.privacy ? "domain.privacy_on" : "domain.privacy_off", {});
  }
  return { ok: true };
}

const HTTP_URL = /^https?:\/\/[^\s/$.?#][^\s]*$/i;

/** Forward the whole domain to a URL (Hostinger), or remove the forwarding (null). */
export async function setForwarding(
  admin: SupabaseClient,
  row: Row,
  f: { redirectType: "301" | "302"; redirectUrl: string } | null,
  actorId: string,
): Promise<ManageResult> {
  if (row.registrar !== "hostinger") {
    return refuse(422, "Forwarding for Cloudflare domains is set up with a redirect rule in Cloudflare.", "https://dash.cloudflare.com/?to=/:account/:zone/rules/redirect-rules");
  }
  if (f && !HTTP_URL.test(f.redirectUrl.trim())) return refuse(400, "Forward to a full web address, e.g. https://example.com");
  const r = f ? await hg.setHostingerForwarding(row.domain, f.redirectType, f.redirectUrl.trim()) : await hg.deleteHostingerForwarding(row.domain);
  if (!r.ok) return refuse(502, `Hostinger: ${r.message}`, registrarDashboardUrl(row));
  await log(admin, actorId, row, f ? "domain.forwarding_set" : "domain.forwarding_removed", f ? { to: f.redirectUrl.trim(), type: f.redirectType } : {});
  return { ok: true };
}

/** The transfer (EPP) code, for moving the domain to another registrar. Logged. */
export async function revealAuthCode(admin: SupabaseClient, row: Row, actorId: string): Promise<ManageResult<{ code: string | null }>> {
  if (row.registrar !== "hostinger") {
    return refuse(422, "Cloudflare's API can't give a transfer code — get it in Cloudflare: Manage domains → the domain → Configuration → Transfer out.", registrarDashboardUrl(row));
  }
  const r = await hg.getHostingerAuthCode(row.domain);
  if (!r.ok) return refuse(502, `Hostinger: ${r.message}`, registrarDashboardUrl(row));
  await log(admin, actorId, row, "domain.auth_code_viewed", {});
  return { ok: true, code: r.code };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Give the domain to another Hostinger account (e.g. the client's own); it moves once they accept. */
export async function startMove(admin: SupabaseClient, row: Row, email: string, actorId: string): Promise<ManageResult> {
  if (row.registrar !== "hostinger") {
    return refuse(422, "Cloudflare domains move to another account with a transfer out, in Cloudflare.", registrarDashboardUrl(row));
  }
  const to = email.trim().toLowerCase();
  if (!EMAIL.test(to)) return refuse(400, "Enter the email of the Hostinger account that should receive the domain");
  const r = await hg.startHostingerDomainMove(row.domain, to);
  if (!r.ok) return refuse(502, `Hostinger: ${r.message}`, registrarDashboardUrl(row));
  await saveDetails(admin, row, { move: { email: to, status: "initiated", started_at: new Date().toISOString() } });
  await log(admin, actorId, row, "domain.move_started", { to });
  return { ok: true };
}

export async function cancelMove(admin: SupabaseClient, row: Row, actorId: string): Promise<ManageResult> {
  if (row.registrar !== "hostinger") return refuse(422, "Only Hostinger domains can be moved from here");
  const r = await hg.cancelHostingerDomainMove(row.domain);
  if (!r.ok) return refuse(502, `Hostinger: ${r.message}`, registrarDashboardUrl(row));
  await saveDetails(admin, row, { move: null });
  await log(admin, actorId, row, "domain.move_cancelled", {});
  return { ok: true };
}

// ---------------------------------------------------------------------------
// renewal

/**
 * Renew for another year NOW — charges the company's default payment method.
 * Works for expired Hostinger domains too while Hostinger still allows it.
 */
export async function renewNow(admin: SupabaseClient, row: Row, actorId: string): Promise<ManageResult<{ pending: boolean; totalCents: number | null }>> {
  if (row.registrar === "cloudflare") {
    return refuse(
      422,
      "Cloudflare's API can't renew a domain. Renew it in Cloudflare (Manage domains → the domain → Renew), or keep auto-renew on and Cloudflare renews it on the expiry date.",
      registrarDashboardUrl(row),
    );
  }
  if (!row.hostinger_subscription_id) {
    return refuse(422, "This domain's Hostinger subscription isn't known yet — press Sync now, or renew it in hPanel.", registrarDashboardUrl(row));
  }
  const r = await hg.renewHostingerSubscription(row.hostinger_subscription_id);
  if (!r.ok) return refuse(502, `Hostinger: ${r.message}`, registrarDashboardUrl(row));
  await log(admin, actorId, row, "domain.renewed", { order_status: r.orderStatus, total_cents: r.totalCents, pending: r.pending });
  return { ok: true, pending: r.pending, totalCents: r.totalCents };
}

// ---------------------------------------------------------------------------
// DNS records — one shape for both registrars

export const EDITABLE_DNS_TYPES = ["A", "AAAA", "CNAME", "ALIAS", "MX", "TXT", "CAA"] as const;

export interface DnsRow {
  /** Cloudflare record id, or "type|name|raw" on Hostinger */
  id: string;
  type: string;
  /** "@" for the domain itself, else the part before it ("www", "mail") */
  name: string;
  content: string;
  /** the registrar's exact content (Hostinger keeps MX priority inside it) */
  raw: string;
  ttl: number;
  priority: number | null;
  proxied: boolean | null;
  editable: boolean;
}

export interface DnsInput {
  type: string;
  name: string;
  content: string;
  ttl: number;
  priority?: number | null;
  proxied?: boolean | null;
}

/** Pure: Hostinger's record sets → rows. Tested. */
export function hostingerRows(zone: HostingerZoneRecord[]): DnsRow[] {
  return zone.flatMap((set) =>
    set.records.map((rec) => {
      const mx = set.type === "MX" ? /^(\d+)\s+(.+)$/.exec(rec.content.trim()) : null;
      return {
        id: `${set.type}|${set.name}|${rec.content}`,
        type: set.type,
        name: set.name,
        content: mx ? mx[2] : rec.content,
        raw: rec.content,
        ttl: set.ttl,
        priority: mx ? Number(mx[1]) : null,
        proxied: null,
        editable: (EDITABLE_DNS_TYPES as readonly string[]).includes(set.type),
      };
    }),
  );
}

/** The content Hostinger stores for a record: MX carries its priority; TXT is quoted. */
export function hostingerContent(r: Pick<DnsInput, "type" | "content" | "priority">): string {
  const c = r.content.trim();
  if (r.type === "MX") return `${r.priority ?? 10} ${c}`;
  if (r.type === "TXT" && !/^"[\s\S]*"$/.test(c)) return `"${c.replace(/"/g, '\\"')}"`;
  return c;
}

type SetChange = { put: { name: string; type: string; ttl: number; records: { content: string }[] }[]; remove: { name: string; type: string }[] };

/**
 * Pure: the record-set writes that turn `original` into `next` on Hostinger
 * (whose API replaces whole name+type sets). Either side may be null: add
 * (no original), delete (no next). Sets left empty are removed. Tested.
 */
export function planHostingerChange(zone: HostingerZoneRecord[], original: DnsRow | null, next: DnsInput | null): SetChange {
  const key = (name: string, type: string) => `${type}|${name}`;
  const sets = new Map(zone.map((s) => [key(s.name, s.type), { name: s.name, type: s.type, ttl: s.ttl, contents: s.records.map((r) => r.content) }]));
  const touched = new Set<string>();
  if (original) {
    const k = key(original.name, original.type);
    const s = sets.get(k);
    if (s) {
      s.contents = s.contents.filter((c) => c !== original.raw);
      touched.add(k);
    }
  }
  if (next) {
    const k = key(next.name, next.type);
    const s = sets.get(k) ?? { name: next.name, type: next.type, ttl: next.ttl, contents: [] };
    const raw = hostingerContent(next);
    if (!s.contents.includes(raw)) s.contents.push(raw);
    s.ttl = next.ttl;
    sets.set(k, s);
    touched.add(k);
  }
  const change: SetChange = { put: [], remove: [] };
  for (const k of touched) {
    const s = sets.get(k)!;
    if (s.contents.length) change.put.push({ name: s.name, type: s.type, ttl: s.ttl, records: s.contents.map((content) => ({ content })) });
    else change.remove.push({ name: s.name, type: s.type });
  }
  return change;
}

/** Pure: Cloudflare's records → rows (names relative to the domain). Tested. */
export function cloudflareRows(records: cf.DnsRecord[], domain: string): DnsRow[] {
  const apex = domain.toLowerCase();
  return records.map((r) => {
    const fq = r.name.toLowerCase();
    const name = fq === apex ? "@" : fq.endsWith(`.${apex}`) ? fq.slice(0, -(apex.length + 1)) : fq;
    return {
      id: r.id,
      type: r.type,
      name,
      content: r.content,
      raw: r.content,
      ttl: r.ttl ?? 1,
      priority: typeof r.priority === "number" ? r.priority : null,
      proxied: typeof r.proxied === "boolean" ? r.proxied : null,
      editable: (EDITABLE_DNS_TYPES as readonly string[]).includes(r.type) && r.type !== "ALIAS",
    };
  });
}

const LABEL = /^(@|\*|(\*\.)?[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)*)$/i;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const HOSTNAME = /^([a-z0-9_]([a-z0-9_-]*[a-z0-9_])?\.)*[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?\.?$/i;

/** Pure: is this record writable as given? An error message, or null. Tested. */
export function validateDns(registrar: ClientDomainRow["registrar"], r: DnsInput): string | null {
  const type = r.type.toUpperCase();
  if (!(EDITABLE_DNS_TYPES as readonly string[]).includes(type)) return `${r.type} records can't be edited here`;
  if (type === "ALIAS" && registrar !== "hostinger") return "ALIAS records exist on Hostinger only — on Cloudflare use a CNAME at @";
  if (!LABEL.test(r.name.trim())) return "Name must be @ or a host name like www or mail";
  const c = r.content.trim();
  if (!c) return "Content is required";
  if (c.length > 2048) return "Content is too long";
  if (type === "A" && !IPV4.test(c)) return "An A record points at an IPv4 address, e.g. 76.13.203.71";
  if (type === "AAAA" && !c.includes(":")) return "An AAAA record points at an IPv6 address";
  if (["CNAME", "ALIAS", "MX"].includes(type) && !HOSTNAME.test(c)) return `A ${type} record points at a host name, e.g. example.com`;
  if (type === "CNAME" && r.name.trim() === "@" && registrar === "hostinger") return "Use an ALIAS record for @ on Hostinger (a CNAME can't sit at the domain itself)";
  if (type === "MX" && (r.priority === null || r.priority === undefined || r.priority < 0 || r.priority > 65535)) return "MX needs a priority from 0 to 65535";
  if (!Number.isInteger(r.ttl) || (r.ttl !== 1 && (r.ttl < 60 || r.ttl > 86400))) return "TTL must be between 60 and 86400 seconds";
  return null;
}

async function cfZoneId(admin: SupabaseClient, row: Row): Promise<string | null> {
  if (row.cf_zone_id) return row.cf_zone_id;
  const z = await cf.findZone(row.domain);
  if (!z || z === "error") return null;
  await admin.from("client_domains").update({ cf_zone_id: z.id }).eq("id", row.id);
  return z.id;
}

export interface DnsListing {
  rows: DnsRow[];
  supportsReset: boolean;
  supportsSnapshots: boolean;
  supportsProxy: boolean;
}

export async function listDns(admin: SupabaseClient, row: Row): Promise<ManageResult<{ dns: DnsListing }>> {
  if (row.registrar === "hostinger") {
    const zone = await hg.getHostingerZone(row.domain);
    if (!zone) return refuse(502, "Could not read the DNS zone from Hostinger");
    return { ok: true, dns: { rows: hostingerRows(zone), supportsReset: true, supportsSnapshots: true, supportsProxy: false } };
  }
  const zoneId = await cfZoneId(admin, row);
  if (!zoneId) return refuse(404, "This domain has no DNS zone on Cloudflare yet");
  const recs = await cf.listDnsRecords(zoneId);
  if (!recs) return refuse(502, "Could not read the DNS zone from Cloudflare");
  return { ok: true, dns: { rows: cloudflareRows(recs, row.domain), supportsReset: false, supportsSnapshots: false, supportsProxy: true } };
}

/** Add (no original), change, or delete (no next) one record. */
export async function changeDns(
  admin: SupabaseClient,
  row: Row,
  change: { original: DnsRow | null; next: DnsInput | null },
  actorId: string,
): Promise<ManageResult> {
  const next = change.next ? { ...change.next, type: change.next.type.toUpperCase(), name: change.next.name.trim().toLowerCase() || "@" } : null;
  if (next) {
    const bad = validateDns(row.registrar, next);
    if (bad) return refuse(400, bad);
  }
  if (!change.original && !next) return refuse(400, "Nothing to change");
  const action = !change.original ? "added" : !next ? "deleted" : "changed";

  if (row.registrar === "hostinger") {
    const zone = await hg.getHostingerZone(row.domain);
    if (!zone) return refuse(502, "Could not read the DNS zone from Hostinger");
    if (change.original && !hostingerRows(zone).some((r) => r.id === change.original!.id)) {
      return refuse(409, "That record changed since the page loaded — reload the records");
    }
    const plan = planHostingerChange(zone, change.original, next);
    if (plan.put.length) {
      const r = await hg.putHostingerZone(row.domain, plan.put);
      if (!r.ok) return refuse(502, `Hostinger: ${r.message}`);
    }
    if (plan.remove.length) {
      const r = await hg.deleteHostingerZoneRecords(row.domain, plan.remove);
      if (!r.ok) return refuse(502, `Hostinger: ${r.message}`);
    }
  } else {
    const zoneId = await cfZoneId(admin, row);
    if (!zoneId) return refuse(404, "This domain has no DNS zone on Cloudflare yet");
    const input = (d: DnsInput): cf.DnsRecordInput => ({
      type: d.type,
      name: d.name === "@" ? row.domain : `${d.name}.${row.domain}`,
      content: d.content.trim(),
      ttl: d.ttl,
      proxied: ["A", "AAAA", "CNAME"].includes(d.type) ? Boolean(d.proxied) : undefined,
      ...(d.type === "MX" ? { priority: d.priority ?? 10 } : {}),
    });
    const r = !next
      ? await cf.deleteDnsRecord(zoneId, change.original!.id)
      : change.original
        ? await cf.updateDnsRecord(zoneId, change.original.id, input(next))
        : await cf.createDnsRecord(zoneId, input(next));
    if (!r.ok) return refuse(502, `Cloudflare: ${r.message ?? "the change was refused"}`);
  }
  await log(admin, actorId, row, "domain.dns_changed", {
    change: action,
    before: change.original ? { type: change.original.type, name: change.original.name, content: change.original.content } : null,
    after: next ? { type: next.type, name: next.name, content: next.content.trim() } : null,
  });
  return { ok: true };
}

/** Hostinger only: back to its default records (email records are kept). */
export async function resetDns(admin: SupabaseClient, row: Row, actorId: string): Promise<ManageResult> {
  if (row.registrar !== "hostinger") return refuse(422, "Only Hostinger zones can be reset to defaults");
  const r = await hg.resetHostingerZone(row.domain);
  if (!r.ok) return refuse(502, `Hostinger: ${r.message}`);
  await log(admin, actorId, row, "domain.dns_reset", {});
  return { ok: true };
}

export async function listDnsSnapshots(row: Row): Promise<ManageResult<{ snapshots: hg.HostingerDnsSnapshot[] }>> {
  if (row.registrar !== "hostinger") return refuse(422, "DNS history is kept by Hostinger zones only");
  const s = await hg.listHostingerDnsSnapshots(row.domain);
  if (!s) return refuse(502, "Could not read the DNS history from Hostinger");
  return { ok: true, snapshots: s.slice(0, 30) };
}

export async function restoreDnsSnapshot(admin: SupabaseClient, row: Row, snapshotId: number, actorId: string): Promise<ManageResult> {
  if (row.registrar !== "hostinger") return refuse(422, "DNS history is kept by Hostinger zones only");
  const r = await hg.restoreHostingerDnsSnapshot(row.domain, snapshotId);
  if (!r.ok) return refuse(502, `Hostinger: ${r.message}`);
  await log(admin, actorId, row, "domain.dns_restored", { snapshot_id: snapshotId });
  return { ok: true };
}
