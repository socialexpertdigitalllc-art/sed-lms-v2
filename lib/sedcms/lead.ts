import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import { siteHostFrom } from "@/lib/site-studio/deploy/liveFiles";
import { subFromWebsiteLink } from "@/lib/template-engine/directadmin";
import { resolveSite } from "./files";
import { isUuid, sedcmsError } from "./http";

/**
 * The lead a CMS site is linked to, and where its site lives now. SERVER ONLY.
 *
 * leads.website_link is the LMS's pointer to a lead's site, and it changes
 * (shuffle, a new version, a move to a custom domain). It is resolved the
 * LMS's way, with siteHostFrom; but it never decides on its own where the CMS
 * may write: the lead's SED CMS link does (lib/sedcms/links.ts), and a lead
 * whose website_link resolves elsewhere is a 409 HOST_CHANGED until a manager
 * confirms the new address.
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

/** The summary of a linked lead at its linked `host`, or null when the hosting couldn't be asked (a 502, not a guess). */
export async function leadSummary(lead: SedcmsLead, host: string): Promise<LeadSummary | null> {
  const site = await resolveSite(host);
  if (!site.ok && site.code === "HOSTING") return null;
  const isStatic = site.ok;
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
