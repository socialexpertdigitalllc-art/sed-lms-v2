// lib/domains/service.ts — what the domain routes do, kept out of the route
// files so it can be tested and reused.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  checkDomains,
  registerDomain,
  registrarSandbox,
  searchDomains,
  setAutoRenew,
  type DomainCheck,
  type RegistrantContact,
} from "@/lib/cloudflare/client";

/** Registrant for Cloudflare SANDBOX test purchases only (never real ones). */
const SANDBOX_CONTACTS: { registrant: RegistrantContact } = {
  registrant: {
    email: "sandbox-test@example.com",
    phone: "+1.5555550100",
    postal_info: {
      name: "SED LMS Sandbox Test",
      organization: "SED LMS Sandbox Test",
      address: { street: "1 Test Street", city: "Atlanta", state: "GA", postal_code: "30301", country_code: "US" },
    },
  },
};
import {
  checkHostingerAvailability,
  getHostingerDomainPrice,
  purchaseHostingerDomain,
  enableHostingerAutoRenew,
} from "@/lib/hostinger/client";
import { normalizeTargetDomain } from "@/lib/site-studio/deploy/transfer";
import { siteHostFrom } from "@/lib/site-studio/deploy/liveFiles";
import { toCents, type ClientDomainRow, type DomainRegistrar } from "./types";

// ---------------------------------------------------------------------------
// search

export interface DomainOffer {
  domain: string;
  registrar: DomainRegistrar;
  available: boolean;
  /** Why it can't be bought here (taken, premium, extension not sold via API, …). */
  reason: string | null;
  registrationCents: number | null;
  renewalCents: number | null;
  currency: string;
}

const REASONS: Record<string, string> = {
  domain_unavailable: "Taken",
  domain_premium: "Premium price — buy in the Cloudflare dashboard",
  extension_not_supported_via_api: "This extension can't be bought through the API yet",
  extension_not_supported: "Cloudflare doesn't sell this extension",
  extension_disallows_registration: "This extension doesn't allow registration",
};

function cfOffer(c: DomainCheck): DomainOffer {
  const premium = c.tier === "premium";
  return {
    domain: c.name.toLowerCase(),
    registrar: "cloudflare",
    available: c.registrable && !premium,
    reason: c.registrable && !premium ? null : (REASONS[c.reason ?? (premium ? "domain_premium" : "")] ?? "Not available"),
    registrationCents: toCents(c.pricing?.registration_cost),
    renewalCents: toCents(c.pricing?.renewal_cost),
    currency: c.pricing?.currency ?? "USD",
  };
}

const looksLikeDomain = (q: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(q.trim());
const HOSTINGER_TLDS = ["com", "net", "org", "co", "us"];

/** Availability + price for a phrase ("jj remodeling atlanta") or a full name. */
export async function searchOffers(query: string, registrar: DomainRegistrar): Promise<DomainOffer[] | null> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  if (registrar === "cloudflare") {
    if (looksLikeDomain(q)) {
      // the exact name first (authoritative), then a few alternatives
      const [exact, more] = await Promise.all([checkDomains([q.replace(/^www\./, "")]), searchDomains(q.split(".")[0], 8)]);
      if (!exact) return null;
      const seen = new Set<string>();
      return [...exact, ...(more ?? [])].map(cfOffer).filter((o) => (seen.has(o.domain) ? false : (seen.add(o.domain), true)));
    }
    const found = await searchDomains(q, 12);
    return found ? found.map(cfOffer) : null;
  }

  // Hostinger: one label across a few popular extensions (or the exact name)
  const names = looksLikeDomain(q) ? [q.replace(/^www\./, "")] : HOSTINGER_TLDS.map((t) => `${q.replace(/[^a-z0-9-]/g, "")}.${t}`);
  const offers: DomainOffer[] = [];
  for (const name of names) {
    const tld = name.slice(name.indexOf(".") + 1);
    const [avail, price] = await Promise.all([checkHostingerAvailability(name), getHostingerDomainPrice(tld)]);
    if (!avail) continue;
    offers.push({
      domain: name,
      registrar: "hostinger",
      available: avail.available && Boolean(price),
      reason: !avail.available ? "Taken" : !price ? "No Hostinger price for this extension" : null,
      registrationCents: price?.firstCents ?? null,
      renewalCents: price?.renewCents ?? null,
      currency: price?.currency ?? "USD",
    });
  }
  return offers;
}

// ---------------------------------------------------------------------------
// purchase

export type PurchaseResult =
  | { ok: true; domain: ClientDomainRow }
  | { ok: false; status: number; error: string };

/**
 * Buy a domain — spends money, non-refundable. The order of operations is the
 * safety design:
 *   1. reserve the domain row FIRST (unique on domain): a double-click or a
 *      second admin can never buy the same name twice;
 *   2. re-check availability + price on the server, refusing if the price is
 *      not exactly what the buyer confirmed (or it went premium / got taken);
 *   3. only then call the registrar.
 * Anything that fails before step 3 releases the reservation — nothing bought.
 */
export async function purchaseDomain(
  admin: SupabaseClient,
  input: { domain: string; registrar: DomainRegistrar; leadId: string | null; expectedCents: number; actorId: string },
): Promise<PurchaseResult> {
  const target = normalizeTargetDomain(input.domain, process.env.DA_DOMAIN ?? "");
  if (!target.ok) return { ok: false, status: 422, error: target.error };
  const domain = target.domain;

  if (input.leadId) {
    const { data: lead } = await admin.from("leads").select("id").eq("id", input.leadId).maybeSingle();
    if (!lead) return { ok: false, status: 404, error: "Lead not found" };
    const { data: has } = await admin
      .from("client_domains")
      .select("domain")
      .eq("lead_id", input.leadId)
      .neq("status", "failed")
      .maybeSingle();
    if (has) return { ok: false, status: 409, error: `This lead already has the domain ${has.domain} — unlink it first` };
  }

  // 1. reserve (a failed earlier attempt for the same name may be reused)
  const now = new Date().toISOString();
  const reservation = {
    domain,
    registrar: input.registrar,
    origin: "purchased",
    lead_id: input.leadId,
    status: "purchasing",
    step: "registration",
    steps: { registration: { state: "running", at: now, detail: "Checking the price" } },
    last_error: null,
    attempts: 0,
    next_run_at: null,
    purchased_by: input.actorId,
    purchased_at: now,
    created_by: input.actorId,
    updated_at: now,
  };
  const { data: prior } = await admin.from("client_domains").select("id, status").eq("domain", domain).maybeSingle();
  let rowId: string;
  if (prior) {
    if (prior.status !== "failed") return { ok: false, status: 409, error: `${domain} is already ours (or being bought right now)` };
    const { data: reused } = await admin
      .from("client_domains")
      .update(reservation)
      .eq("id", prior.id)
      .eq("status", "failed")
      .select("id")
      .maybeSingle();
    if (!reused) return { ok: false, status: 409, error: `${domain} is being bought right now` };
    rowId = reused.id as string;
  } else {
    const { data: created, error } = await admin.from("client_domains").insert(reservation).select("id").single();
    if (error || !created) {
      return /duplicate|unique/i.test(error?.message ?? "")
        ? { ok: false, status: 409, error: `${domain} is already ours (or being bought right now)` }
        : { ok: false, status: 500, error: `Could not reserve the domain: ${error?.message ?? "insert failed"}` };
    }
    rowId = created.id as string;
  }
  const release = async (error: string, status: number): Promise<PurchaseResult> => {
    await admin.from("client_domains").delete().eq("id", rowId).eq("status", "purchasing");
    return { ok: false, status, error };
  };

  // 2. authoritative availability + price, right before buying
  let priceCents: number | null = null;
  let renewCents: number | null = null;
  let currency = "USD";
  let hostingerItemId: string | null = null;
  if (input.registrar === "cloudflare") {
    const checked = await checkDomains([domain]);
    const c = checked?.find((x) => x.name.toLowerCase() === domain);
    if (!c) return release("Could not confirm availability with Cloudflare — nothing was bought, try again", 502);
    const offer = cfOffer(c);
    if (!offer.available) return release(`${domain} can't be bought: ${offer.reason}`, 409);
    priceCents = offer.registrationCents;
    renewCents = offer.renewalCents;
    currency = offer.currency;
  } else {
    const tld = domain.slice(domain.indexOf(".") + 1);
    const [avail, price] = await Promise.all([checkHostingerAvailability(domain), getHostingerDomainPrice(tld)]);
    if (!avail || !price) return release("Could not confirm availability with Hostinger — nothing was bought, try again", 502);
    if (!avail.available) return release(`${domain} is taken`, 409);
    priceCents = price.firstCents;
    renewCents = price.renewCents;
    currency = price.currency;
    hostingerItemId = price.itemId;
  }
  if (priceCents === null || priceCents !== input.expectedCents) {
    const now$ = priceCents === null ? "unknown" : `$${(priceCents / 100).toFixed(2)}`;
    return release(`The price changed to ${now$} since you checked — nothing was bought. Please confirm the new price.`, 409);
  }

  // 3. buy
  const at = new Date().toISOString();
  if (input.registrar === "cloudflare") {
    // Real purchases use the account's default contact; the sandbox has no
    // address book, so test buys carry obviously fake test details.
    const r = registrarSandbox() ? await registerDomain(domain, { contacts: SANDBOX_CONTACTS }) : await registerDomain(domain);
    if (!r.ok && r.status >= 400 && r.status < 500) {
      // a definite refusal — nothing was registered or charged
      return release(`Cloudflare refused the registration: ${r.message}`, 502);
    }
    // ok, or no clear answer (network/5xx): the processor asks Cloudflare what happened
    const failedNow = r.ok && r.workflow.state === "failed";
    const { data: row } = await admin
      .from("client_domains")
      .update({
        registration_cost_cents: priceCents,
        renewal_cost_cents: renewCents,
        currency,
        status: failedNow ? "failed" : "purchasing",
        last_error: failedNow ? (r.workflow.error?.message ?? "Cloudflare could not register the domain") : r.ok ? null : `Waiting for Cloudflare (${r.message})`,
        steps: { registration: { state: failedNow ? "failed" : "running", at, detail: failedNow ? "Registration failed" : "Registration submitted to Cloudflare" } },
        next_run_at: failedNow ? null : at,
        updated_at: at,
      })
      .eq("id", rowId)
      .select("*")
      .single();
    await logPurchase(admin, input.actorId, domain, input.registrar, priceCents, input.leadId, failedNow ? "failed" : "submitted");
    return failedNow ? { ok: false, status: 502, error: "Cloudflare could not register the domain" } : { ok: true, domain: row as ClientDomainRow };
  }

  const r = await purchaseHostingerDomain(domain, hostingerItemId as string);
  if (!r.ok) return release(`Hostinger refused the order: ${r.message}`, 502);
  const { data: row } = await admin
    .from("client_domains")
    .update({
      registration_cost_cents: priceCents,
      renewal_cost_cents: renewCents,
      currency,
      hostinger_order_id: r.orderId,
      hostinger_subscription_id: r.subscriptionId,
      steps: {
        registration: {
          state: "running",
          at,
          detail: r.registered ? "Registered on Hostinger" : "Order placed — Hostinger is processing the payment",
        },
      },
      next_run_at: at,
      updated_at: at,
    })
    .eq("id", rowId)
    .select("*")
    .single();
  await logPurchase(admin, input.actorId, domain, input.registrar, priceCents, input.leadId, r.orderStatus);
  return { ok: true, domain: row as ClientDomainRow };
}

async function logPurchase(
  admin: SupabaseClient,
  actorId: string,
  domain: string,
  registrar: DomainRegistrar,
  cents: number,
  leadId: string | null,
  outcome: string,
) {
  await admin.from("activity_log").insert({
    user_id: actorId,
    action: "domain.purchased",
    entity_type: "client_domain",
    entity_id: null,
    new_value: { domain, registrar, price_cents: cents, lead_id: leadId, outcome },
  });
}

// ---------------------------------------------------------------------------
// assignment, retry, auto-renew

export type MutateResult = { ok: true; domain: ClientDomainRow; kick: boolean } | { ok: false; status: number; error: string };

/**
 * Link a domain to a lead (or unlink it with leadId null). Linking an
 * unassigned domain starts the automatic setup; a `connected` domain (set up
 * by hand) is only linked — the pipeline never runs for it.
 */
export async function assignDomain(
  admin: SupabaseClient,
  id: string,
  leadId: string | null,
  actorId: string,
): Promise<MutateResult> {
  const { data: rowData } = await admin.from("client_domains").select("*").eq("id", id).maybeSingle();
  if (!rowData) return { ok: false, status: 404, error: "Domain not found" };
  const row = rowData as ClientDomainRow;
  const now = new Date().toISOString();

  if (leadId === null) {
    const active = ["setting_up", "waiting_for_site", "needs_attention"].includes(row.status);
    const patch: Record<string, unknown> = { lead_id: null, updated_at: now, claim_id: null, claimed_at: null };
    if (active) Object.assign(patch, { status: "unassigned", next_run_at: null });
    const { data, error } = await admin.from("client_domains").update(patch).eq("id", id).select("*").single();
    if (error || !data) return { ok: false, status: 500, error: error?.message ?? "update failed" };
    await logAssign(admin, actorId, row, null);
    return { ok: true, domain: data as ClientDomainRow, kick: false };
  }

  if (row.status === "purchasing" || row.status === "failed") {
    return { ok: false, status: 409, error: "Wait for the purchase to finish before linking this domain" };
  }
  const { data: lead } = await admin.from("leads").select("id, website_link").eq("id", leadId).maybeSingle();
  if (!lead) return { ok: false, status: 404, error: "Lead not found" };
  const { data: other } = await admin
    .from("client_domains")
    .select("domain")
    .eq("lead_id", leadId)
    .neq("status", "failed")
    .neq("id", id)
    .maybeSingle();
  if (other) return { ok: false, status: 409, error: `This lead already has the domain ${other.domain} — unlink it first` };

  const patch: Record<string, unknown> = { lead_id: leadId, updated_at: now };
  let kick = false;
  if (row.status === "unassigned") {
    // start the automatic setup
    Object.assign(patch, { status: "setting_up", step: null, attempts: 0, last_error: null, next_run_at: now, claim_id: null, claimed_at: null, steps: {} });
    kick = true;
  }
  const { data, error } = await admin.from("client_domains").update(patch).eq("id", id).select("*").single();
  if (error || !data) {
    return /duplicate|unique/i.test(error?.message ?? "")
      ? { ok: false, status: 409, error: "This lead already has a domain — unlink it first" }
      : { ok: false, status: 500, error: error?.message ?? "update failed" };
  }
  // A domain set up by hand serves the site already — make it the lead's link
  // if the lead has none.
  if (row.status === "connected" && !(lead as { website_link: string | null }).website_link) {
    await admin.from("leads").update({ website_link: `https://${row.domain}` }).eq("id", leadId);
  }
  await logAssign(admin, actorId, row, leadId);
  return { ok: true, domain: data as ClientDomainRow, kick };
}

async function logAssign(admin: SupabaseClient, actorId: string, row: ClientDomainRow, leadId: string | null) {
  await admin.from("activity_log").insert({
    user_id: actorId,
    action: leadId ? "domain.linked" : "domain.unlinked",
    entity_type: "client_domain",
    entity_id: row.id,
    new_value: { domain: row.domain, lead_id: leadId, previous_lead_id: row.lead_id },
  });
}

/** Retry a domain whose setup stopped: resume from the step that failed. */
export async function retryDomain(admin: SupabaseClient, id: string, actorId: string): Promise<MutateResult> {
  const { data: rowData } = await admin.from("client_domains").select("*").eq("id", id).maybeSingle();
  if (!rowData) return { ok: false, status: 404, error: "Domain not found" };
  const row = rowData as ClientDomainRow;
  if (row.status !== "needs_attention" && row.status !== "waiting_for_site") {
    return { ok: false, status: 409, error: "Only a domain whose setup stopped (or is waiting) can be retried" };
  }
  if (!row.lead_id) return { ok: false, status: 409, error: "Link the domain to a lead first" };
  const now = new Date().toISOString();
  const registering = row.step === "registration" && row.origin === "purchased";
  const { data, error } = await admin
    .from("client_domains")
    .update({
      status: registering ? "purchasing" : "setting_up",
      attempts: 0,
      last_error: null,
      next_run_at: now,
      claim_id: null,
      claimed_at: null,
      updated_at: now,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) return { ok: false, status: 500, error: error?.message ?? "update failed" };
  await admin.from("activity_log").insert({
    user_id: actorId,
    action: "domain.retried",
    entity_type: "client_domain",
    entity_id: id,
    new_value: { domain: row.domain, step: row.step, error: row.last_error },
  });
  return { ok: true, domain: data as ClientDomainRow, kick: true };
}

/** Auto-renew on/off at the registrar (Hostinger: on only — its API has no "off" here). */
export async function setDomainAutoRenew(
  admin: SupabaseClient,
  id: string,
  on: boolean,
  actorId: string,
): Promise<MutateResult> {
  const { data: rowData } = await admin.from("client_domains").select("*").eq("id", id).maybeSingle();
  if (!rowData) return { ok: false, status: 404, error: "Domain not found" };
  const row = rowData as ClientDomainRow;
  if (row.registrar === "cloudflare") {
    const r = await setAutoRenew(row.domain, on);
    if (!r.ok) return { ok: false, status: 502, error: `Cloudflare: ${r.message ?? "could not change auto-renew"}` };
  } else {
    if (!on) return { ok: false, status: 422, error: "Turn auto-renew off for Hostinger domains in hPanel" };
    if (!row.hostinger_subscription_id) return { ok: false, status: 422, error: "No Hostinger subscription recorded for this domain" };
    const r = await enableHostingerAutoRenew(row.hostinger_subscription_id);
    if (!r.ok) return { ok: false, status: 502, error: `Hostinger: ${r.message ?? "could not enable auto-renew"}` };
  }
  const { data, error } = await admin
    .from("client_domains")
    .update({ auto_renew: on, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) return { ok: false, status: 500, error: error?.message ?? "update failed" };
  await admin.from("activity_log").insert({
    user_id: actorId,
    action: on ? "domain.auto_renew_on" : "domain.auto_renew_off",
    entity_type: "client_domain",
    entity_id: id,
    new_value: { domain: row.domain },
  });
  return { ok: true, domain: data as ClientDomainRow, kick: false };
}

/** The domain row linked to a lead (any status but failed), or null. */
export async function domainForLead(admin: SupabaseClient, leadId: string): Promise<ClientDomainRow | null> {
  const { data } = await admin.from("client_domains").select("*").eq("lead_id", leadId).neq("status", "failed").maybeSingle();
  return (data as ClientDomainRow | null) ?? null;
}

/** Suggested search phrase for a lead: its business name, or its current site's host. */
export function suggestQuery(businessName: string | null, websiteLink: string | null): string {
  const host = siteHostFrom(websiteLink ?? "");
  const daDomain = (process.env.DA_DOMAIN ?? "").toLowerCase();
  if (host && daDomain && !host.endsWith(`.${daDomain}`)) return host.replace(/^www\./, "");
  return (businessName ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
