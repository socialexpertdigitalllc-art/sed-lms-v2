import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import { notify } from "@/lib/notifications/notify";
import { siteHostFrom } from "@/lib/site-studio/deploy/liveFiles";
import { sedcmsError } from "./http";
import { leadHost, type SedcmsLead } from "./lead";

/**
 * Which leads SED CMS may touch, and where (migration 0094, sedcms_links).
 * SERVER ONLY.
 *
 * leads.website_link alone never decides where the CMS writes: it is free
 * text that sales can change. A manager (studio.manage) turns SED CMS on for
 * one lead at one host, from "Open in CMS", after a plain-words confirmation.
 * Then:
 *   - a lead with no active link is a 404 NO_LEAD on every internal route;
 *   - the CMS reads and writes only the linked host;
 *   - when the lead's website_link now resolves to another host, every
 *     internal route that touches the site is a 409 HOST_CHANGED until a
 *     manager confirms the new address (which updates the link);
 *   - one active link per lead, and one per site (www. or not), so one
 *     site is never linked to two leads.
 * On a linked lead, moving website_link to another host needs studio.manage
 * (websiteMoveRefusal), and the managers are told (noteWebsiteLinkChange).
 */

export interface SedcmsLink {
  id: string;
  leadId: string;
  host: string;
}

export type LinkRead = { ok: true; link: SedcmsLink | null } | { ok: false; missingTable: boolean };

const LINK_COLUMNS = "id, lead_id, host";

/** One site whatever its www.: the key of migration 0094's one-per-site index. */
export function siteKey(host: string): string {
  return host.replace(/^www\./, "");
}

/** Migration 0094 not applied yet: the tables aren't there. */
export function isMissingSedcmsTables(error: { message?: unknown } | null | undefined): boolean {
  const msg = typeof error?.message === "string" ? error.message : "";
  return /sedcms_(links|requests)/.test(msg) && /(does not exist|schema cache|could not find)/i.test(msg);
}

function asLink(row: unknown): SedcmsLink | null {
  const r = row as { id?: unknown; lead_id?: unknown; host?: unknown } | null;
  if (!r || typeof r.id !== "string" || typeof r.lead_id !== "string" || typeof r.host !== "string") return null;
  return { id: r.id, leadId: r.lead_id, host: r.host };
}

/** The lead's active link (null: none). A row that isn't a link is an error, never "none". */
export async function readLink(admin: SupabaseClient, leadId: string): Promise<LinkRead> {
  try {
    const { data, error } = await admin.from("sedcms_links").select(LINK_COLUMNS).eq("lead_id", leadId).is("revoked_at", null).maybeSingle();
    if (error) return { ok: false, missingTable: isMissingSedcmsTables(error) };
    if (data === null || data === undefined) return { ok: true, link: null };
    const link = asLink(data);
    if (!link || link.leadId !== leadId) return { ok: false, missingTable: false };
    return { ok: true, link };
  } catch {
    return { ok: false, missingTable: false };
  }
}

/** The other lead whose active link holds the site at `host` (www. or not), if any. */
export async function siteHolder(admin: SupabaseClient, host: string, leadId: string): Promise<{ ok: true; leadId: string | null } | { ok: false }> {
  const key = siteKey(host);
  try {
    const { data, error } = await admin.from("sedcms_links").select(LINK_COLUMNS).in("host", [key, `www.${key}`]).is("revoked_at", null);
    if (error || !Array.isArray(data)) return { ok: false };
    const links = data.map(asLink);
    if (links.some((l) => l === null)) return { ok: false };
    const other = (links as SedcmsLink[]).find((l) => l.leadId !== leadId);
    return { ok: true, leadId: other?.leadId ?? null };
  } catch {
    return { ok: false };
  }
}

const isUniqueViolation = (error: { code?: unknown } | null | undefined) => error?.code === "23505";

export type LinkSave = { ok: true } | { ok: false; taken: boolean };

/** Turn SED CMS on for the lead at `host`. Taken: another lead holds the site, or the lead was just linked elsewhere. */
export async function createLink(admin: SupabaseClient, leadId: string, host: string, userId: string): Promise<LinkSave> {
  try {
    const { error } = await admin.from("sedcms_links").insert({ lead_id: leadId, host, linked_by: userId });
    if (!error) return { ok: true };
    if (!isUniqueViolation(error)) return { ok: false, taken: false };
    // Someone may have linked this lead to this very host a moment ago.
    const now = await readLink(admin, leadId);
    return now.ok && now.link?.host === host ? { ok: true } : { ok: false, taken: true };
  } catch {
    return { ok: false, taken: false };
  }
}

/** Move the lead's link from its old host to `host` (a manager confirmed the new address). */
export async function moveLink(admin: SupabaseClient, link: SedcmsLink, host: string, userId: string): Promise<LinkSave> {
  try {
    const { data, error } = await admin
      .from("sedcms_links")
      .update({ host, linked_by: userId, linked_at: new Date().toISOString() })
      .eq("id", link.id)
      .eq("host", link.host)
      .is("revoked_at", null)
      .select("id");
    if (error) return { ok: false, taken: isUniqueViolation(error) };
    if (Array.isArray(data) && data.length === 1) return { ok: true };
    // Changed under us: fine only when it now says exactly this.
    const now = await readLink(admin, link.leadId);
    return now.ok && now.link?.host === host ? { ok: true } : { ok: false, taken: false };
  } catch {
    return { ok: false, taken: false };
  }
}

// ---------------------------------------------------------------------------
// the internal routes

export const NOT_LINKED_MESSAGE = "This lead isn't turned on for SED CMS in the LMS. Ask a manager to press Open in CMS on the lead.";

export function hostChangedMessage(from: string, to: string | null): string {
  return to
    ? `The website address changed from ${from} to ${to}. A manager must confirm the new address.`
    : `The lead has no website address any more (it was ${from}). A manager must give it one and confirm it.`;
}

function linkReadRefusal(read: { missingTable: boolean }): NextResponse {
  if (read.missingTable) {
    console.error("[sedcms] the sedcms_links table is missing: migration 0094 is not applied");
    return sedcmsError(503, "NOT_CONFIGURED", "The LMS is not set up to take CMS requests.");
  }
  console.error("[sedcms] a lead's SED CMS link could not be read");
  return sedcmsError(500, "INTERNAL", "The lead's link could not be read.");
}

/** The lead's active link, or the answer for a lead the CMS may not touch (404 NO_LEAD). */
export async function requireLink(admin: SupabaseClient, lead: SedcmsLead): Promise<{ ok: true; link: SedcmsLink } | { ok: false; response: NextResponse }> {
  const read = await readLink(admin, lead.id);
  if (!read.ok) return { ok: false, response: linkReadRefusal(read) };
  if (!read.link) return { ok: false, response: sedcmsError(404, "NO_LEAD", NOT_LINKED_MESSAGE) };
  return { ok: true, link: read.link };
}

/**
 * The host the CMS may act on for this lead: its link's, while the lead's
 * website still resolves there; `expected` (the host the CMS sends) must be
 * that host too.
 *   404 NO_LEAD — no active link;
 *   409 HOST_CHANGED { host, linkedHost, needsConfirmation: true } — the lead
 *       now points elsewhere (host: where, null for nowhere), until a
 *       manager confirms it;
 *   409 HOST_CHANGED { host } — the CMS expects another host than the linked one.
 */
export async function linkedHost(
  admin: SupabaseClient,
  lead: SedcmsLead,
  expected?: string,
): Promise<{ ok: true; host: string; link: SedcmsLink } | { ok: false; response: NextResponse }> {
  const linked = await requireLink(admin, lead);
  if (!linked.ok) return linked;
  const { link } = linked;
  const current = leadHost(lead);
  if (current !== link.host) {
    return {
      ok: false,
      response: sedcmsError(409, "HOST_CHANGED", hostChangedMessage(link.host, current), {
        host: current,
        linkedHost: link.host,
        needsConfirmation: true,
      }),
    };
  }
  if (expected !== undefined && expected !== link.host) {
    return { ok: false, response: sedcmsError(409, "HOST_CHANGED", "The lead's website is not at that address any more.", { host: link.host }) };
  }
  return { ok: true, host: link.host, link };
}

// ---------------------------------------------------------------------------
// website_link on a linked lead

export const MOVE_NEEDS_MANAGER =
  "SED CMS is turned on for this lead's website, so only a manager (Manage Site Studio) can move, replace or take down its website.";

export type MoveRefusal = { status: 403 | 503; error: string };

/**
 * Why this user may not move, replace or take down the website of `leadId`,
 * or null when they may: on a lead SED CMS is turned on for, that is a
 * manager's call (studio.manage); unlinked leads are as before. Fails closed
 * (503) when the link can't be read, except while migration 0094 isn't
 * applied, when no lead can be linked.
 */
export async function linkedSiteRefusal(admin: SupabaseClient, leadId: string, perms: ReadonlySet<string>): Promise<MoveRefusal | null> {
  if (perms.has("studio.manage")) return null;
  const read = await readLink(admin, leadId);
  if (!read.ok) return read.missingTable ? null : { status: 503, error: "The website can't be changed just now. Try again." };
  return read.link ? { status: 403, error: MOVE_NEEDS_MANAGER } : null;
}

/** linkedSiteRefusal, for an edit of website_link itself: only a move to another host counts. */
export async function websiteMoveRefusal(
  admin: SupabaseClient,
  leadId: string,
  before: string | null | undefined,
  after: string | null | undefined,
  perms: ReadonlySet<string>,
): Promise<MoveRefusal | null> {
  if (siteHostFrom(before ?? "") === siteHostFrom(after ?? "")) return null;
  return linkedSiteRefusal(admin, leadId, perms);
}

/**
 * After a write that may have changed a lead's website_link (call it even
 * when the write was conditional): when SED CMS is turned on for the lead and
 * its website no longer resolves to the linked host, the CMS is paused for
 * it, so the change is logged and the managers are told (once per old -> new
 * within the hour). `before` and `after`, when both known, skip everything
 * for a same-host change. Never throws.
 */
export async function noteWebsiteLinkChange(
  admin: SupabaseClient,
  change: { leadId: string; before?: string | null; after?: string | null; actorId: string | null },
): Promise<void> {
  try {
    if (change.before !== undefined && change.after !== undefined && siteHostFrom(change.before ?? "") === siteHostFrom(change.after ?? "")) return;
    const read = await readLink(admin, change.leadId);
    if (!read.ok || !read.link) return;
    const from = read.link.host;

    // Where the lead's website is now, whatever the write did.
    const { data: lead, error } = await admin.from("leads").select("business_name, website_link").eq("id", change.leadId).maybeSingle();
    if (error || !lead) return;
    const row = lead as { business_name?: unknown; website_link?: unknown };
    const to = siteHostFrom(typeof row.website_link === "string" ? row.website_link : "");
    if (to === from) return;
    const name = typeof row.business_name === "string" && row.business_name.trim() ? row.business_name : "A lead";

    const { error: logError } = await admin.from("activity_log").insert({
      user_id: change.actorId,
      action: "sedcms.host_changed",
      entity_type: "lead",
      entity_id: change.leadId,
      old_value: { host: from },
      new_value: { host: to },
    });
    if (logError) console.warn(`[sedcms] the sedcms.host_changed row for lead ${change.leadId} was not written`);

    await notify(
      "sedcms_host_changed",
      { leadId: change.leadId, actorId: change.actorId },
      {
        title: "SED CMS paused for a lead",
        body: `${name}: ${hostChangedMessage(from, to)} Open the lead and press Open in CMS.`,
        dedupKey: `sedcms_host_changed:${change.leadId}:${from}:${to ?? "none"}:${new Date().toISOString().slice(0, 13)}`,
        targetUrl: `/leads/${change.leadId}`,
      },
    );
  } catch {
    console.warn(`[sedcms] the managers could not be told that lead ${change.leadId}'s website address changed`);
  }
}
