// lib/domains/import.ts — bring the domains we already own into the dashboard:
// the Cloudflare account's registrations and the Hostinger portfolio. A domain
// whose site is already up was set up by hand — hosted on Hostinger, or
// pointing at a server elsewhere — so it is recorded as `connected` (and linked
// to the lead whose website link is that domain) and the pipeline NEVER runs
// for it. Only a domain that points nowhere (or at Hostinger's parking page) is
// `unassigned` — assigning it to a lead starts the automatic setup. The
// company's own domains (PROTECTED_DOMAINS + the staging apex) are never
// client domains and are left out.
import type { SupabaseClient } from "@supabase/supabase-js";
import { listRegistrations, type CfRegistration } from "@/lib/cloudflare/client";
import { listDomains, listWebsites, type HostingerDomain, type HostingerWebsite } from "@/lib/hostinger/client";
import { siteHostFrom } from "@/lib/site-studio/deploy/liveFiles";
import { isProtectedDomain } from "@/lib/site-studio/deploy/protected";
import { dnsUse as realDnsUse } from "./dns";
import type { DomainRegistrar } from "./types";

export interface ImportSummary {
  total: number;
  added: number;
  connected: number;
  unassigned: number;
  linked: number;
  refreshed: number;
  /** Not brought in this time: DNS unreadable (retried next import), or the
   *  name is already listed under the other registrar. */
  skipped: number;
  autoRenewOff: string[];
}

/** A domain as its registrar reports it. */
export interface OwnedDomain {
  domain: string;
  /** null = the registrar doesn't say (Hostinger's API has no per-domain flag). */
  autoRenew: boolean | null;
  expiresAt: string | null;
}

export interface ImportDeps {
  /** Every website on the Hostinger account(s). */
  websites: HostingerWebsite[];
  /** Where a domain Hostinger doesn't host points — see dns.ts. */
  dnsUse: (domain: string) => Promise<"free" | "in_use" | null>;
}

export type ImportResult = { ok: true; summary: ImportSummary } | { ok: false; error: string };

const apexOf = (host: string | null) => (host ?? "").toLowerCase().replace(/^www\./, "");

/**
 * Pure: decide what an imported domain becomes. `use` is consulted only when
 * Hostinger doesn't host the domain; null there = can't tell yet (skip — the
 * next import asks again). Tested.
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

/** Pure: the Cloudflare registrations as owned domains. */
export function cloudflareOwned(regs: CfRegistration[]): OwnedDomain[] {
  return regs.map((r) => ({ domain: r.domain_name.toLowerCase(), autoRenew: r.auto_renew, expiresAt: r.expires_at ?? null }));
}

/** Pure: the Hostinger portfolio's registered domains (expired and
 *  not-yet-set-up entries are left out). A name can be listed twice — a
 *  plan's free domain (no expiry date) later registered for real — so the
 *  entry that expires last wins. Tested. */
export function hostingerOwned(portfolio: HostingerDomain[]): OwnedDomain[] {
  const byName = new Map<string, OwnedDomain>();
  for (const d of portfolio) {
    if (d.status !== "active" || !d.domain) continue;
    const o: OwnedDomain = { domain: d.domain.toLowerCase(), autoRenew: null, expiresAt: d.expires_at ?? null };
    const prev = byName.get(o.domain);
    if (!prev || (o.expiresAt ?? "") > (prev.expiresAt ?? "")) byName.set(o.domain, o);
  }
  return [...byName.values()];
}

async function importOwned(
  admin: SupabaseClient,
  actorId: string,
  registrar: DomainRegistrar,
  owned: OwnedDomain[],
  deps: ImportDeps,
): Promise<ImportSummary> {
  const list = owned.filter((d) => !isProtectedDomain(d.domain));
  const hosted = new Map(deps.websites.map((w) => [w.domain.toLowerCase(), w]));
  const names = list.map((d) => d.domain);

  // Leads whose website link IS one of these domains (https://x.com, www.x.com, …)
  const leadByDomain = new Map<string, string>();
  for (let i = 0; i < names.length; i += 20) {
    const chunk = names.slice(i, i + 20);
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

  const { data: existingRows } = names.length
    ? await admin.from("client_domains").select("id, domain, registrar").in("domain", names)
    : { data: [] };
  const existing = new Map(
    ((existingRows ?? []) as { id: string; domain: string; registrar: DomainRegistrar }[]).map((r) => [r.domain, r]),
  );

  const summary: ImportSummary = { total: list.length, added: 0, connected: 0, unassigned: 0, linked: 0, refreshed: 0, skipped: 0, autoRenewOff: [] };
  const now = new Date().toISOString();
  for (const d of list) {
    // what the registrar says; an auto-renew it doesn't report is left as is
    const facts = { expires_at: d.expiresAt, updated_at: now, ...(d.autoRenew === null ? {} : { auto_renew: d.autoRenew }) };
    if (d.autoRenew === false) summary.autoRenewOff.push(d.domain);
    const known = existing.get(d.domain);
    if (known) {
      if (known.registrar !== registrar) {
        // listed under the other registrar (e.g. moved) — that row stays as it is
        summary.skipped++;
        continue;
      }
      const { error } = await admin.from("client_domains").update(facts).eq("id", known.id);
      if (!error) summary.refreshed++;
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
      ...facts,
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

  await admin.from("activity_log").insert({
    user_id: actorId,
    action: "domain.imported",
    entity_type: "client_domain",
    entity_id: null,
    new_value: { registrar, ...summary },
  });
  return summary;
}

async function depsWith(websites?: HostingerWebsite[]): Promise<ImportDeps | null> {
  const ws = websites ?? (await listWebsites());
  return ws ? { websites: ws, dnsUse: realDnsUse } : null;
}

export async function importCloudflareDomains(admin: SupabaseClient, actorId: string, websites?: HostingerWebsite[]): Promise<ImportResult> {
  const regs = await listRegistrations();
  if (!regs) return { ok: false, error: "Could not read the domains on the Cloudflare account" };
  const deps = await depsWith(websites);
  if (!deps) return { ok: false, error: "Could not read the websites on Hostinger" };
  return { ok: true, summary: await importOwned(admin, actorId, "cloudflare", cloudflareOwned(regs), deps) };
}

export async function importHostingerDomains(admin: SupabaseClient, actorId: string, websites?: HostingerWebsite[]): Promise<ImportResult> {
  const portfolio = await listDomains();
  if (!portfolio) return { ok: false, error: "Could not read the domains on the Hostinger account" };
  const deps = await depsWith(websites);
  if (!deps) return { ok: false, error: "Could not read the websites on Hostinger" };
  return { ok: true, summary: await importOwned(admin, actorId, "hostinger", hostingerOwned(portfolio), deps) };
}

/** Both registrars, one website listing. Cloudflare only when configured. */
export async function importAllDomains(
  admin: SupabaseClient,
  actorId: string,
  opts: { cloudflare: boolean },
): Promise<{ ok: true; cloudflare: ImportResult | null; hostinger: ImportResult } | { ok: false; error: string }> {
  const websites = await listWebsites();
  if (!websites) return { ok: false, error: "Could not read the websites on Hostinger" };
  const hostinger = await importHostingerDomains(admin, actorId, websites);
  const cloudflare = opts.cloudflare ? await importCloudflareDomains(admin, actorId, websites) : null;
  return { ok: true, cloudflare, hostinger };
}
