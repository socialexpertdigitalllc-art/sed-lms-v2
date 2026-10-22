import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import { siteHostFrom } from "@/lib/site-studio/deploy/liveFiles";
import { subFromWebsiteLink } from "@/lib/template-engine/directadmin";
import { resolveSite } from "./files";
import { isUuid, sedcmsError } from "./http";

/**
 * The lead a CMS site is linked to, and where its site lives now. SERVER ONLY.
 *
 * The LMS has no sites table: leads.website_link is the only pointer to a
 * lead's site, and it changes (shuffle, a new version, a move to a custom
 * domain). So the CMS sends the host it expects with every call, and a lead
 * that now points elsewhere is a 409 HOST_CHANGED carrying the current host.
 * The host is resolved the LMS's way, with siteHostFrom.
 */

export interface SedcmsLead {
  id: string;
  business_name: string;
  business_email: string | null;
  status: string;
  website_link: string | null;
}

export type LeadLookup = { ok: true; lead: SedcmsLead } | { ok: false; response: NextResponse };

/** A live (not deleted) lead, or a 404 NO_LEAD. */
export async function loadLead(admin: SupabaseClient, leadId: string): Promise<LeadLookup> {
  const missing = { ok: false as const, response: sedcmsError(404, "NO_LEAD", "There is no such lead.") };
  if (!isUuid(leadId)) return missing;
  const { data, error } = await admin
    .from("leads")
    .select("id, business_name, business_email, status, website_link")
    .eq("id", leadId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error(`[sedcms] reading lead ${leadId} failed`);
    return { ok: false, response: sedcmsError(500, "INTERNAL", "The lead could not be read.") };
  }
  return data ? { ok: true, lead: data as SedcmsLead } : missing;
}

/** The lead's site host now, or null when it has none. */
export function leadHost(lead: SedcmsLead): string | null {
  return siteHostFrom(lead.website_link ?? "");
}

export function hostKindOf(host: string | null): "staging" | "custom" | null {
  if (!host) return null;
  const daDomain = process.env.DA_DOMAIN ?? "";
  return daDomain && subFromWebsiteLink(`https://${host}`, daDomain) ? "staging" : "custom";
}

/** The lead's current host, when it is the one the CMS expects; else 409 HOST_CHANGED. */
export function expectHost(lead: SedcmsLead, expected: string): { ok: true; host: string } | { ok: false; response: NextResponse } {
  const host = leadHost(lead);
  if (host === null || host !== expected) {
    return { ok: false, response: sedcmsError(409, "HOST_CHANGED", "The lead's website is not at that address any more.", { host }) };
  }
  return { ok: true, host };
}

export interface LeadSummary {
  leadId: string;
  businessName: string;
  businessEmail: string | null;
  status: string;
  host: string | null;
  hostKind: "staging" | "custom" | null;
  /** The LMS can read and write this site's files as a static site. */
  isStatic: boolean;
}

/** The summary, or null when the hosting couldn't be asked (a 502, not a guess). */
export async function leadSummary(lead: SedcmsLead): Promise<LeadSummary | null> {
  const host = leadHost(lead);
  let isStatic = false;
  if (host) {
    const site = await resolveSite(host);
    if (!site.ok && site.code === "HOSTING") return null;
    isStatic = site.ok;
  }
  return {
    leadId: lead.id,
    businessName: lead.business_name,
    businessEmail: lead.business_email ?? null,
    status: lead.status,
    host,
    hostKind: hostKindOf(host),
    isStatic,
  };
}
