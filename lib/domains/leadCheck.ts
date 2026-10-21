// lib/domains/leadCheck.ts — "does the business's exact name exist as a .com?"
// Checked the moment a lead turns Ready (and kept fresh while it stays Ready),
// so by the time sales talks domains with the customer the card already says
// whether abcconstruction.com is free. One row per lead in lead_domain_checks
// (migration 0091) — not on `leads`, so a check never bumps the lead's
// updated_at or fires the leads realtime feed.
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cloudflareConfigured } from "@/lib/cloudflare/client";
import { hostingerConfigured } from "@/lib/hostinger/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkExactDomains, exactDomainFor, type DomainOffer } from "./service";
import type { DomainRegistrar } from "./types";

export interface LeadDomainCheck {
  lead_id: string;
  domain: string;
  /** null = the registrar gave no answer (error says why) */
  available: boolean | null;
  /** Why it can't be bought: "Taken", a premium price, … */
  reason: string | null;
  registration_cents: number | null;
  renewal_cents: number | null;
  currency: string;
  registrar: DomainRegistrar | null;
  error: string | null;
  checked_at: string;
}

const HOUR_MS = 3_600_000;
/** Availability changes: a Ready lead's check is refreshed this often. */
export const LEAD_CHECK_STALE_MS = 7 * 24 * HOUR_MS;
/** A check the registrar didn't answer is retried this soon. */
export const LEAD_CHECK_RETRY_MS = 30 * 60_000;

/**
 * The domain a business's exact name would be, always on .com: spaces and
 * punctuation dropped ("ABC Construction LLC" → abcconstructionllc.com), the
 * same rule as the Buy dialog's exact match. Null when nothing usable is left.
 * PURE; tested.
 */
export function leadExactDomain(businessName: string | null | undefined): string | null {
  const e = exactDomainFor(businessName ?? "");
  return e ? `${e.label}.com` : null;
}

/** Which registrar answers availability checks (Cloudflare first, as the Buy dialog does). */
export function checkRegistrar(): DomainRegistrar | null {
  return cloudflareConfigured() ? "cloudflare" : hostingerConfigured() ? "hostinger" : null;
}

function rowFrom(leadId: string, domain: string, registrar: DomainRegistrar, offer: DomainOffer | null | undefined, now: Date): LeadDomainCheck {
  return {
    lead_id: leadId,
    domain,
    available: offer ? offer.available : null,
    reason: offer?.reason ?? null,
    registration_cents: offer?.registrationCents ?? null,
    renewal_cents: offer?.renewalCents ?? null,
    currency: offer?.currency ?? "USD",
    registrar,
    error: offer ? null : `${registrar === "cloudflare" ? "Cloudflare" : "Hostinger"} gave no answer — it will be checked again soon.`,
    checked_at: now.toISOString(),
  };
}

export interface LeadCheckDeps {
  check?: typeof checkExactDomains;
  registrar?: DomainRegistrar | null;
  now?: Date;
}

/**
 * Check these leads' exact .com names now and store the answers. Leads without
 * a usable business name are skipped. Never throws; returns what was stored.
 */
export async function checkLeadDomains(
  admin: SupabaseClient,
  leads: { id: string; business_name: string | null }[],
  deps: LeadCheckDeps = {},
): Promise<LeadDomainCheck[]> {
  const registrar = deps.registrar === undefined ? checkRegistrar() : deps.registrar;
  if (!registrar) return [];
  const now = deps.now ?? new Date();
  const wanted = leads.map((l) => ({ id: l.id, domain: leadExactDomain(l.business_name) })).filter((l): l is { id: string; domain: string } => Boolean(l.domain));
  if (!wanted.length) return [];
  try {
    const offers = await (deps.check ?? checkExactDomains)(
      wanted.map((w) => w.domain),
      registrar,
    );
    const rows = wanted.map((w) => rowFrom(w.id, w.domain, registrar, offers?.get(w.domain), now));
    const { error } = await admin.from("lead_domain_checks").upsert(rows, { onConflict: "lead_id" });
    return error ? [] : rows;
  } catch {
    return [];
  }
}

/** One lead, by id: reads its current business name first. */
export async function checkLeadDomain(admin: SupabaseClient, leadId: string, deps: LeadCheckDeps = {}): Promise<LeadDomainCheck | null> {
  const { data } = await admin.from("leads").select("id, business_name").eq("id", leadId).is("deleted_at", null).maybeSingle();
  if (!data) return null;
  const [row] = await checkLeadDomains(admin, [data as { id: string; business_name: string | null }], deps);
  return row ?? null;
}

/**
 * Check soon, after the response — from a status change to Ready. Outside a
 * request (a background job) it just runs. Never throws.
 */
export function kickLeadDomainChecks(leadIds: string[]): void {
  const ids = [...new Set(leadIds)].slice(0, 200);
  if (!ids.length || !checkRegistrar()) return;
  const run = async () => {
    const admin = createAdminClient();
    const { data } = await admin.from("leads").select("id, business_name").in("id", ids).is("deleted_at", null);
    await checkLeadDomains(admin, (data ?? []) as { id: string; business_name: string | null }[]);
  };
  try {
    after(() => run().catch(() => {}));
  } catch {
    void run().catch(() => {});
  }
}

export async function loadLeadDomainCheck(admin: SupabaseClient, leadId: string): Promise<LeadDomainCheck | null> {
  const { data, error } = await admin.from("lead_domain_checks").select("*").eq("lead_id", leadId).maybeSingle();
  if (error) return null; // before migration 0091: no checks yet
  return (data as LeadDomainCheck | null) ?? null;
}

/**
 * Pure: which Ready leads to check now — never checked, renamed since (the
 * stored name no longer matches), a failed check due for a retry, or an
 * answer older than a week. Never-checked first. Tested.
 */
export function dueLeadChecks(
  leads: { id: string; business_name: string | null }[],
  checks: Pick<LeadDomainCheck, "lead_id" | "domain" | "available" | "checked_at">[],
  now: Date,
  limit: number,
): { id: string; business_name: string | null }[] {
  const byLead = new Map(checks.map((c) => [c.lead_id, c]));
  const t = now.getTime();
  const rank = (l: { id: string; business_name: string | null }): number | null => {
    const domain = leadExactDomain(l.business_name);
    if (!domain) return null;
    const c = byLead.get(l.id);
    if (!c || c.domain !== domain) return 0;
    const age = t - Date.parse(c.checked_at);
    if (c.available === null && age >= LEAD_CHECK_RETRY_MS) return 1;
    if (age >= LEAD_CHECK_STALE_MS) return 2;
    return null;
  };
  return leads
    .map((l) => ({ l, r: rank(l) }))
    .filter((x): x is { l: { id: string; business_name: string | null }; r: number } => x.r !== null)
    .sort((a, b) => a.r - b.r)
    .slice(0, limit)
    .map((x) => x.l);
}

/**
 * The background round (rides on /api/domains/sweep): Ready leads whose check
 * is missing or due — new Ready leads from imports or creation, renamed ones,
 * week-old answers. Cloudflare answers 20 names per call, so `limit` costs
 * limit/20 calls.
 */
export async function leadDomainCheckSweep(admin: SupabaseClient, opts: LeadCheckDeps & { limit?: number } = {}): Promise<{ checked: number }> {
  const registrar = opts.registrar === undefined ? checkRegistrar() : opts.registrar;
  if (!registrar) return { checked: 0 };
  const [{ data: leads }, { data: checks, error }] = await Promise.all([
    admin.from("leads").select("id, business_name").eq("status", "Ready").is("deleted_at", null),
    admin.from("lead_domain_checks").select("lead_id, domain, available, checked_at"),
  ]);
  if (error) return { checked: 0 }; // before migration 0091
  const due = dueLeadChecks(
    (leads ?? []) as { id: string; business_name: string | null }[],
    (checks ?? []) as LeadDomainCheck[],
    opts.now ?? new Date(),
    opts.limit ?? 60,
  );
  const rows = await checkLeadDomains(admin, due, { ...opts, registrar });
  return { checked: rows.length };
}
