// lib/domains/import.ts — bring the Cloudflare account's domains into the
// dashboard. A domain already hosted on Hostinger was set up by hand: it is
// recorded as `connected` (and linked to the lead whose website link is that
// domain) and the pipeline NEVER runs for it. A domain not hosted anywhere yet
// is `unassigned` — assigning it to a lead starts the automatic setup.
import type { SupabaseClient } from "@supabase/supabase-js";
import { listRegistrations, type CfRegistration } from "@/lib/cloudflare/client";
import { listWebsites, type HostingerWebsite } from "@/lib/hostinger/client";
import { siteHostFrom } from "@/lib/site-studio/deploy/liveFiles";

export interface ImportSummary {
  total: number;
  added: number;
  connected: number;
  unassigned: number;
  linked: number;
  refreshed: number;
  autoRenewOff: string[];
}

const apexOf = (host: string | null) => (host ?? "").toLowerCase().replace(/^www\./, "");

/** Pure: decide what an imported registration becomes. Tested. */
export function classifyImport(
  reg: CfRegistration,
  hosted: Map<string, HostingerWebsite>,
  leadByDomain: Map<string, string>,
): { domain: string; status: "connected" | "unassigned"; leadId: string | null; hostingUsername: string | null } {
  const domain = reg.domain_name.toLowerCase();
  const site = hosted.get(domain);
  if (!site) return { domain, status: "unassigned", leadId: null, hostingUsername: null };
  return { domain, status: "connected", leadId: leadByDomain.get(domain) ?? null, hostingUsername: site.username };
}

export async function importCloudflareDomains(
  admin: SupabaseClient,
  actorId: string,
): Promise<{ ok: true; summary: ImportSummary } | { ok: false; error: string }> {
  const regs = await listRegistrations();
  if (!regs) return { ok: false, error: "Could not read the domains on the Cloudflare account" };
  const websites = await listWebsites();
  if (!websites) return { ok: false, error: "Could not read the websites on Hostinger" };
  const hosted = new Map(websites.map((w) => [w.domain.toLowerCase(), w]));
  const names = regs.map((r) => r.domain_name.toLowerCase());

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

  const { data: existingRows } = await admin.from("client_domains").select("id, domain").in("domain", names);
  const existing = new Map(((existingRows ?? []) as { id: string; domain: string }[]).map((r) => [r.domain, r.id]));

  const summary: ImportSummary = { total: regs.length, added: 0, connected: 0, unassigned: 0, linked: 0, refreshed: 0, autoRenewOff: [] };
  const now = new Date().toISOString();
  for (const reg of regs) {
    const facts = { auto_renew: reg.auto_renew, expires_at: reg.expires_at ?? null, updated_at: now };
    if (reg.auto_renew === false) summary.autoRenewOff.push(reg.domain_name.toLowerCase());
    const id = existing.get(reg.domain_name.toLowerCase());
    if (id) {
      // known already: only refresh the registrar facts
      const { error } = await admin.from("client_domains").update(facts).eq("id", id);
      if (!error) summary.refreshed++;
      continue;
    }
    const c = classifyImport(reg, hosted, leadByDomain);
    const leadId = c.leadId && !leadsWithDomain.has(c.leadId) ? c.leadId : null;
    const { error } = await admin.from("client_domains").insert({
      domain: c.domain,
      registrar: "cloudflare",
      origin: "imported",
      status: c.status,
      lead_id: leadId,
      hosting_username: c.hostingUsername,
      ...facts,
      created_by: actorId,
      steps: {},
    });
    if (error) continue;
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
    new_value: { registrar: "cloudflare", ...summary },
  });
  return { ok: true, summary };
}
