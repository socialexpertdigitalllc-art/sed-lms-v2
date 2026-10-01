// lib/domains/import.ts — keep the dashboard in step with both registrars: the
// Cloudflare account's registrations and the Hostinger portfolio, expired
// domains included. Runs on demand ("Sync now") and in the background.
//
// A NEW domain whose site is already up was set up by hand — hosted on
// Hostinger, or pointing at a server elsewhere — so it is recorded as
// `connected` (and linked to the lead whose website link is that domain) and
// the pipeline NEVER runs for it. Only a domain that points nowhere (or at
// Hostinger's parking page) is `unassigned` — assigning it to a lead starts the
// automatic setup. The company's own domains (PROTECTED_DOMAINS + the staging
// apex) are never client domains and are left out.
//
// A KNOWN domain only gets its registrar facts refreshed — expiry, status,
// auto-renew, price, next charge — and only when they changed; its status and
// lead are never touched. A known domain the registrar no longer lists is
// marked `missing` (moved, transferred out or deleted), never deleted.
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkDomains, listRegistrations, type CfRegistration } from "@/lib/cloudflare/client";
import {
  listDomains,
  listSubscriptions,
  listWebsites,
  type HostingerDomain,
  type HostingerSubscription,
  type HostingerWebsite,
} from "@/lib/hostinger/client";
import { siteHostFrom } from "@/lib/site-studio/deploy/liveFiles";
import { isProtectedDomain } from "@/lib/site-studio/deploy/protected";
import { notify as realNotify } from "@/lib/notifications/notify";
import { dnsUse as realDnsUse } from "./dns";
import { matchSubscriptions, renewalFacts } from "./subscriptions";
import { renewalBucket, toCents, type DomainDetails, type DomainRegistrar } from "./types";

export { renewalBucket };

export interface ImportSummary {
  total: number;
  added: number;
  connected: number;
  unassigned: number;
  linked: number;
  /** Known domains whose registrar facts changed. */
  refreshed: number;
  /** Not brought in this time: DNS unreadable (retried next sync), or the name
   *  is already listed under the other registrar. */
  skipped: number;
  /** Registrations the registrar reports as expired. */
  expired: number;
  /** Known domains newly found missing from the account. */
  missing: number;
  autoRenewOff: string[];
}

/** A domain as its registrar reports it. */
export interface OwnedDomain {
  domain: string;
  /** active | expired | pending | … */
  registrarStatus: string;
  /** null = unknown (e.g. a Hostinger domain whose subscription couldn't be matched) */
  autoRenew: boolean | null;
  expiresAt: string | null;
  registeredAt: string | null;
  nextBillingAt: string | null;
  renewalCents: number | null;
  currency: string | null;
  subscriptionId: string | null;
  /** Only what this registrar's listing says — merged into the stored snapshot. */
  details: DomainDetails;
}

export interface ImportDeps {
  /** Every website on the Hostinger account(s). */
  websites: HostingerWebsite[];
  /** Where a domain Hostinger doesn't host points — see dns.ts. */
  dnsUse: (domain: string) => Promise<"free" | "in_use" | null>;
  notify?: typeof realNotify;
  now?: Date;
}

export type ImportResult = { ok: true; summary: ImportSummary; newlyExpired: string[] } | { ok: false; error: string };

const apexOf = (host: string | null) => (host ?? "").toLowerCase().replace(/^www\./, "");

/** Registrar vocabulary → ours. */
export function normalizeRegistrarStatus(raw: string | null | undefined): string {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "active") return "active";
  if (s === "expired") return "expired";
  if (["pending_setup", "requested", "pending_verification", "pending", "in_progress"].includes(s)) return "pending";
  return s || "unknown";
}

/**
 * Pure: decide what a NEW domain becomes. `use` is consulted only when
 * Hostinger doesn't host the domain; null there = can't tell yet (skip — the
 * next sync asks again). Tested.
 */
export function classifyImport(
  domainName: string,
  hosted: Map<string, HostingerWebsite>,
  use: "free" | "in_use" | null,
  leadByDomain: Map<string, string>,
): { domain: string; status: "connected" | "unassigned"; leadId: string | null; hostingUsername: string | null } | null {
  const domain = domainName.toLowerCase();
  const site = hosted.get(domain);
  if (site) return { domain, status: "connected", leadId: leadByDomain.get(domain) ?? null, hostingUsername: site.username };
  if (use === "in_use") return { domain, status: "connected", leadId: leadByDomain.get(domain) ?? null, hostingUsername: null };
  if (use === "free") return { domain, status: "unassigned", leadId: null, hostingUsername: null };
  return null;
}

const tldOf = (domain: string) => domain.split(".").slice(1).join(".");

/** Pure: the Cloudflare registrations as owned domains. `prices` = renewal price per extension. */
export function cloudflareOwned(regs: CfRegistration[], prices: Map<string, { cents: number; currency: string }> = new Map()): OwnedDomain[] {
  return regs.map((r) => {
    const domain = r.domain_name.toLowerCase();
    const price = prices.get(tldOf(domain));
    return {
      domain,
      registrarStatus: normalizeRegistrarStatus(r.status),
      autoRenew: r.auto_renew,
      expiresAt: r.expires_at ?? null,
      registeredAt: r.created_at ?? null,
      // Cloudflare charges on the expiry date — only if it is going to renew
      nextBillingAt: r.auto_renew ? (r.expires_at ?? null) : null,
      renewalCents: price?.cents ?? null,
      currency: price?.currency ?? null,
      subscriptionId: null,
      details: {
        ...(typeof r.locked === "boolean" ? { locked: r.locked } : {}),
        ...(r.privacy_mode ? { privacy: r.privacy_mode !== "off" } : {}),
      },
    };
  });
}

/**
 * Pure: the Hostinger portfolio as owned domains, each with what its billing
 * subscription says (auto-renew, renewal price, next charge). A name can be
 * listed twice — a plan's free domain (no expiry date) later registered for
 * real, or a lapsed registration bought again — so the entry that expires last
 * wins. Tested.
 */
export function hostingerOwned(portfolio: HostingerDomain[], subscriptions: HostingerSubscription[] = []): OwnedDomain[] {
  const byName = new Map<string, HostingerDomain>();
  for (const d of portfolio) {
    if (!d.domain) continue;
    const name = d.domain.toLowerCase();
    const prev = byName.get(name);
    if (!prev || (d.expires_at ?? "") > (prev.expires_at ?? "")) byName.set(name, d);
  }
  const entries = [...byName.values()];
  const subs = matchSubscriptions(entries.map((d) => ({ domain: d.domain, expires_at: d.expires_at })), subscriptions);
  return entries.map((d) => {
    const domain = d.domain.toLowerCase();
    const f = renewalFacts(subs.get(domain));
    return {
      domain,
      registrarStatus: normalizeRegistrarStatus(d.status),
      autoRenew: f.autoRenew,
      expiresAt: d.expires_at ?? null,
      registeredAt: d.created_at ?? null,
      nextBillingAt: f.nextBillingAt,
      renewalCents: f.renewalCents,
      currency: f.currency,
      subscriptionId: f.subscriptionId,
      details: f.subscriptionStatus ? { subscription_status: f.subscriptionStatus } : {},
    };
  });
}

/** The stored facts a refresh compares against. */
export interface KnownFacts {
  registrar_status: string | null;
  auto_renew: boolean | null;
  expires_at: string | null;
  registered_at: string | null;
  next_billing_at: string | null;
  renewal_cost_cents: number | null;
  currency: string | null;
  hostinger_subscription_id: string | null;
  details: DomainDetails | null;
}

/** JSON with sorted keys — Postgres hands jsonb back with its own key order. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

const sameInstant = (a: string | null, b: string | null) =>
  a === b || (a !== null && b !== null && Date.parse(a) === Date.parse(b));

/**
 * Pure: the columns to write so a known row matches what the registrar says —
 * empty when nothing changed (no write at all). Facts the registrar doesn't
 * report (null auto-renew, price, subscription) never erase stored ones. Tested.
 */
export function factsPatch(known: KnownFacts, d: OwnedDomain): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (known.registrar_status !== d.registrarStatus) patch.registrar_status = d.registrarStatus;
  if (!sameInstant(known.expires_at, d.expiresAt)) patch.expires_at = d.expiresAt;
  if (d.registeredAt && !sameInstant(known.registered_at, d.registeredAt)) patch.registered_at = d.registeredAt;
  if (!sameInstant(known.next_billing_at, d.nextBillingAt) && (d.nextBillingAt !== null || d.autoRenew !== null)) {
    patch.next_billing_at = d.nextBillingAt;
  }
  if (d.autoRenew !== null && known.auto_renew !== d.autoRenew) patch.auto_renew = d.autoRenew;
  if (d.renewalCents !== null && known.renewal_cost_cents !== d.renewalCents) patch.renewal_cost_cents = d.renewalCents;
  if (d.currency && known.currency !== d.currency) patch.currency = d.currency;
  if (d.subscriptionId && known.hostinger_subscription_id !== d.subscriptionId) patch.hostinger_subscription_id = d.subscriptionId;
  const merged = { ...(known.details ?? {}), ...d.details };
  if (stableJson(merged) !== stableJson(known.details ?? {})) patch.details = merged;
  return patch;
}

const KNOWN_COLUMNS =
  "id, domain, registrar, status, lead_id, registrar_status, auto_renew, expires_at, registered_at, next_billing_at, renewal_cost_cents, currency, hostinger_subscription_id, details";

type KnownRow = KnownFacts & { id: string; domain: string; registrar: DomainRegistrar; status: string; lead_id: string | null };

async function syncOwned(
  admin: SupabaseClient,
  actorId: string | null,
  registrar: DomainRegistrar,
  owned: OwnedDomain[],
  deps: ImportDeps,
): Promise<{ summary: ImportSummary; newlyExpired: string[] }> {
  const list = owned.filter((d) => !isProtectedDomain(d.domain));
  const hosted = new Map(deps.websites.map((w) => [w.domain.toLowerCase(), w]));
  const names = list.map((d) => d.domain);
  const now = (deps.now ?? new Date()).toISOString();

  const { data: existingRows } = names.length
    ? await admin.from("client_domains").select(KNOWN_COLUMNS).in("domain", names)
    : { data: [] };
  const existing = new Map(((existingRows ?? []) as KnownRow[]).map((r) => [r.domain, r]));

  // Leads whose website link IS one of the new domains (https://x.com, www.x.com, …)
  const fresh = names.filter((n) => !existing.has(n));
  const leadByDomain = new Map<string, string>();
  for (let i = 0; i < fresh.length; i += 20) {
    const chunk = fresh.slice(i, i + 20);
    const { data } = await admin
      .from("leads")
      .select("id, website_link")
      .or(chunk.map((d) => `website_link.ilike.%${d}%`).join(","));
    for (const l of (data ?? []) as { id: string; website_link: string | null }[]) {
      const host = apexOf(siteHostFrom(l.website_link ?? ""));
      if (chunk.includes(host) && !leadByDomain.has(host)) leadByDomain.set(host, l.id);
    }
  }

  // A lead keeps ONE working domain (unique index) — don't link a lead that has one
  const candidateLeads = [...new Set(leadByDomain.values())];
  const { data: taken } = candidateLeads.length
    ? await admin.from("client_domains").select("lead_id").in("lead_id", candidateLeads).neq("status", "failed")
    : { data: [] };
  const leadsWithDomain = new Set(((taken ?? []) as { lead_id: string }[]).map((r) => r.lead_id));

  const summary: ImportSummary = {
    total: list.length,
    added: 0,
    connected: 0,
    unassigned: 0,
    linked: 0,
    refreshed: 0,
    skipped: 0,
    expired: 0,
    missing: 0,
    autoRenewOff: [],
  };
  const newlyExpired: string[] = [];
  for (const d of list) {
    if (d.registrarStatus === "expired") summary.expired++;
    if (d.autoRenew === false && d.registrarStatus === "active") summary.autoRenewOff.push(d.domain);
    const known = existing.get(d.domain);
    if (known) {
      if (known.registrar !== registrar) {
        // listed under the other registrar (e.g. moved) — that row stays as it is
        summary.skipped++;
        continue;
      }
      const patch = factsPatch(known, d);
      if (Object.keys(patch).length === 0) continue;
      const { error } = await admin.from("client_domains").update({ ...patch, updated_at: now }).eq("id", known.id);
      if (error) continue;
      summary.refreshed++;
      if (patch.registrar_status === "expired" && known.registrar_status === "active") newlyExpired.push(known.id);
      continue;
    }
    const use = hosted.has(d.domain) ? null : await deps.dnsUse(d.domain);
    const c = classifyImport(d.domain, hosted, use, leadByDomain);
    if (!c) {
      summary.skipped++;
      continue;
    }
    const leadId = c.leadId && !leadsWithDomain.has(c.leadId) ? c.leadId : null;
    const { error } = await admin.from("client_domains").insert({
      domain: c.domain,
      registrar,
      origin: "imported",
      status: c.status,
      lead_id: leadId,
      hosting_username: c.hostingUsername,
      registrar_status: d.registrarStatus,
      expires_at: d.expiresAt,
      registered_at: d.registeredAt,
      next_billing_at: d.nextBillingAt,
      ...(d.autoRenew === null ? {} : { auto_renew: d.autoRenew }),
      renewal_cost_cents: d.renewalCents,
      currency: d.currency,
      hostinger_subscription_id: d.subscriptionId,
      details: d.details,
      synced_at: now,
      created_by: actorId,
      steps: {},
    });
    if (error) {
      summary.skipped++;
      continue;
    }
    summary.added++;
    if (c.status === "connected") summary.connected++;
    else summary.unassigned++;
    if (leadId) {
      summary.linked++;
      leadsWithDomain.add(leadId);
    }
  }

  if (names.length) {
    await admin.from("client_domains").update({ synced_at: now }).eq("registrar", registrar).in("domain", names);
  }

  // Known domains this registrar no longer lists: moved, transferred out or
  // deleted. Marked, never removed (their history stays). A purchase still in
  // flight isn't listed yet and is left alone.
  const { data: ours } = await admin
    .from("client_domains")
    .select("id, domain, status, registrar_status")
    .eq("registrar", registrar);
  const listed = new Set(owned.map((d) => d.domain));
  const ourRows = (ours ?? []) as { id: string; domain: string; status: string; registrar_status: string | null }[];
  const gone = ourRows.filter(
    (r) => !listed.has(r.domain) && r.registrar_status !== "missing" && r.status !== "purchasing" && r.status !== "failed",
  );
  // A listing that suddenly lacks many known domains is more likely a short
  // answer from the registrar than a mass transfer — mark nothing this time.
  if (gone.length <= Math.max(5, Math.ceil(ourRows.length * 0.2))) {
    for (const r of gone) {
      const { error } = await admin.from("client_domains").update({ registrar_status: "missing", updated_at: now }).eq("id", r.id);
      if (!error) summary.missing++;
    }
  }

  if (summary.added || summary.refreshed || summary.missing) {
    await admin.from("activity_log").insert({
      user_id: actorId,
      action: "domain.synced",
      entity_type: "client_domain",
      entity_id: null,
      new_value: { registrar, ...summary },
    });
  }
  return { summary, newlyExpired };
}

/** Cloudflare's at-cost renewal price per extension, read off an availability
 *  check of a throwaway name (the check quotes the price of any registrable name). */
async function cloudflareRenewalPrices(tlds: string[]): Promise<Map<string, { cents: number; currency: string }>> {
  const out = new Map<string, { cents: number; currency: string }>();
  const unique = [...new Set(tlds.filter(Boolean))].slice(0, 20);
  if (!unique.length) return out;
  const probe = (tld: string) => `sed-lms-price-check-7f3k2q.${tld}`;
  // a price is a nice-to-have — never a reason for the sync to fail
  const checked = await checkDomains(unique.map(probe)).catch(() => null);
  for (const c of checked ?? []) {
    const tld = tldOf(c.name.toLowerCase());
    const cents = toCents(c.pricing?.renewal_cost);
    if (cents !== null && c.pricing?.currency) out.set(tld, { cents, currency: c.pricing.currency });
  }
  return out;
}

async function depsWith(websites?: HostingerWebsite[], extra: Partial<ImportDeps> = {}): Promise<ImportDeps | null> {
  const ws = websites ?? (await listWebsites());
  return ws ? { websites: ws, dnsUse: realDnsUse, ...extra } : null;
}

export async function importCloudflareDomains(
  admin: SupabaseClient,
  actorId: string | null,
  websites?: HostingerWebsite[],
  extra: Partial<ImportDeps> = {},
): Promise<ImportResult> {
  const regs = await listRegistrations();
  if (!regs) return { ok: false, error: "Could not read the domains on the Cloudflare account" };
  const deps = await depsWith(websites, extra);
  if (!deps) return { ok: false, error: "Could not read the websites on Hostinger" };
  const prices = await cloudflareRenewalPrices(regs.map((r) => tldOf(r.domain_name.toLowerCase())));
  const r = await syncOwned(admin, actorId, "cloudflare", cloudflareOwned(regs, prices), deps);
  return { ok: true, ...r };
}

export async function importHostingerDomains(
  admin: SupabaseClient,
  actorId: string | null,
  websites?: HostingerWebsite[],
  extra: Partial<ImportDeps> = {},
): Promise<ImportResult> {
  const portfolio = await listDomains();
  if (!portfolio) return { ok: false, error: "Could not read the domains on the Hostinger account" };
  // without the subscriptions auto-renew stays unknown — never a reason to stop
  const subscriptions = (await listSubscriptions()) ?? [];
  const deps = await depsWith(websites, extra);
  if (!deps) return { ok: false, error: "Could not read the websites on Hostinger" };
  const r = await syncOwned(admin, actorId, "hostinger", hostingerOwned(portfolio, subscriptions), deps);
  return { ok: true, ...r };
}

const DAY_MS = 86_400_000;

/**
 * Tell Admin about domains that will lapse: registered, NOT set to renew and
 * expiring within 30 days (reminders at 30, 7 and 1 day), and any that just
 * expired. Deduplicated per domain, expiry and reminder.
 */
export async function sendRenewalAlerts(
  admin: SupabaseClient,
  newlyExpired: string[],
  opts: { notify?: typeof realNotify; now?: Date } = {},
): Promise<number> {
  const notify = opts.notify ?? realNotify;
  const now = opts.now ?? new Date();
  const { data } = await admin
    .from("client_domains")
    .select("id, domain, lead_id, registrar, auto_renew, expires_at, registrar_status, status")
    .in("registrar_status", ["active", "expired"]);
  let sent = 0;
  for (const r of (data ?? []) as {
    id: string;
    domain: string;
    lead_id: string | null;
    registrar: DomainRegistrar;
    auto_renew: boolean | null;
    expires_at: string | null;
    registrar_status: string;
    status: string;
  }[]) {
    if (r.status === "failed") continue;
    const day = (r.expires_at ?? "").slice(0, 10);
    if (newlyExpired.includes(r.id)) {
      await notify("domain_renewal_due", { leadId: r.lead_id, lead: null }, {
        title: `Domain expired: ${r.domain}`,
        body: `${r.domain} expired on ${day}. Renew it from the Domains page before it can be lost.`,
        dedupKey: `domain_renewal_due:${r.id}:expired:${day}`,
        targetUrl: `/domains/${r.id}`,
      });
      sent++;
      continue;
    }
    if (r.registrar_status !== "active" || r.auto_renew !== false) continue;
    const bucket = renewalBucket(r.expires_at, now);
    if (!bucket) continue;
    const days = Math.max(0, Math.ceil((Date.parse(r.expires_at!) - now.getTime()) / DAY_MS));
    await notify("domain_renewal_due", { leadId: r.lead_id, lead: null }, {
      title: `${r.domain} expires in ${days} day${days === 1 ? "" : "s"}`,
      body: `Auto-renew is off on ${r.registrar === "cloudflare" ? "Cloudflare" : "Hostinger"}. Turn it on or renew it from the Domains page, or the site goes offline on ${day}.`,
      dedupKey: `domain_renewal_due:${r.id}:${day}:${bucket}`,
      targetUrl: `/domains/${r.id}`,
    });
    sent++;
  }
  return sent;
}

export type SyncReport =
  | { ok: true; cloudflare: ImportResult | null; hostinger: ImportResult; alerts: number }
  | { ok: false; error: string };

/** Both registrars, one website listing, then the renewal alerts. Cloudflare only when configured. */
export async function importAllDomains(
  admin: SupabaseClient,
  actorId: string | null,
  opts: { cloudflare: boolean; notify?: typeof realNotify; now?: Date },
): Promise<SyncReport> {
  const websites = await listWebsites();
  if (!websites) return { ok: false, error: "Could not read the websites on Hostinger" };
  const extra = { notify: opts.notify, now: opts.now };
  const hostinger = await importHostingerDomains(admin, actorId, websites, extra);
  const cloudflare = opts.cloudflare ? await importCloudflareDomains(admin, actorId, websites, extra) : null;
  const newlyExpired = [hostinger, cloudflare].flatMap((r) => (r && r.ok ? r.newlyExpired : []));
  const alerts = await sendRenewalAlerts(admin, newlyExpired, { notify: opts.notify, now: opts.now }).catch(() => 0);
  return { ok: true, cloudflare, hostinger, alerts };
}
