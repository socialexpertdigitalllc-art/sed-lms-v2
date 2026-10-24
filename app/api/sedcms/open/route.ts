import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { siteHostFrom } from "@/lib/site-studio/deploy/liveFiles";
import { cmsConfig, mintCmsLink } from "@/lib/sedcms/cms";
import { isPlainHost, isProtectedSite } from "@/lib/sedcms/files";
import { isUuid } from "@/lib/sedcms/http";
import { createLink, hostChangedMessage, moveLink, readLink, siteHolder } from "@/lib/sedcms/links";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Who may open a lead's site in the CMS: the people who may overwrite it. */
const ALLOWED_PERMS = ["studio.manage", "tickets.resolve"];
/** Who may turn SED CMS on for a lead, or confirm its new address: a manager. */
const LINK_PERM = "studio.manage";

const Body = z.object({ leadId: z.string().refine(isUuid), confirmHost: z.string().max(253).optional() }).strict();

const answer = (status: number, body: Record<string, unknown>) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * POST /api/sedcms/open { leadId, confirmHost? } — "Open in CMS" on a lead or
 * a ticket. With the developer's own session: the LMS asks SED CMS for a
 * one-time sign-in link for that developer's own CMS account, about this lead
 * (lib/sedcms/cms.ts), and answers { url } for the browser to follow. The
 * link must be on SEDCMS_URL's own address: the LMS never sends anyone
 * anywhere else. It is never logged.
 *
 * It is also where SED CMS is turned on for a lead (lib/sedcms/links.ts):
 *   - a lead it isn't on for: only studio.manage, after confirming
 *     409 CONFIRM_LINK { host, message } by sending confirmHost: host. The
 *     link records the lead's current host (audited sedcms.linked);
 *   - a linked lead whose website address changed: a studio.manage user
 *     confirms 409 CONFIRM_HOST_CHANGE { host, from, message } the same
 *     way, which moves the link (audited sedcms.host_confirmed, old -> new);
 *     anyone else gets 409 HOST_CHANGED;
 *   - a site another lead holds is 409 HOST_TAKEN;
 * so tickets.resolve alone opens only linked leads whose host still matches.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return answer(401, { error: "Unauthorized" });
  const perms = await getUserPermissions(user.id);
  if (!ALLOWED_PERMS.some((p) => perms.has(p))) return answer(403, { error: "Forbidden" });

  // JSON only: a cross-site form can't send it without a preflight.
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return answer(415, { error: "Expected JSON" });
  }
  let parsed: z.infer<typeof Body>;
  try {
    const checked = Body.safeParse(JSON.parse(await req.text()));
    if (!checked.success) return answer(400, { error: "Expected { leadId }" });
    parsed = checked.data;
  } catch {
    return answer(400, { error: "Expected { leadId }" });
  }
  const { leadId, confirmHost } = parsed;

  // RLS-scoped: a lead this user can't see is a 404.
  const { data: lead } = await supabase
    .from("leads")
    .select("id, business_name, website_link")
    .eq("id", leadId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return answer(404, { error: "Lead not found" });

  const cfg = cmsConfig();
  if (!cfg.ok) {
    console.error(`[sedcms] Open in CMS is off: ${cfg.reason}`);
    return answer(503, { code: "CMS_NOT_CONNECTED", error: "The CMS isn't connected to the LMS yet." });
  }

  const { business_name: businessName, website_link: websiteLink } = lead as { business_name: string | null; website_link: string | null };
  const host = siteHostFrom(websiteLink ?? "");
  if (!host || !isPlainHost(host)) {
    return answer(422, { code: "NO_SITE", error: "This lead has no website address the CMS can open." });
  }

  const admin = createAdminClient();
  const linked = await readLink(admin, leadId);
  if (!linked.ok) {
    if (linked.missingTable) console.error("[sedcms] Open in CMS: the sedcms_links table is missing (migration 0094 is not applied)");
    return answer(503, { code: "CMS_NOT_READY", error: "SED CMS isn't set up in the LMS yet." });
  }
  const link = linked.link;
  if (!link || link.host !== host) {
    // Turning SED CMS on for this lead, or moving it to the lead's new address: a manager's decision.
    if (!perms.has(LINK_PERM)) {
      return link
        ? answer(409, { code: "HOST_CHANGED", error: hostChangedMessage(link.host, host) })
        : answer(403, { code: "NOT_LINKED", error: "SED CMS isn't turned on for this lead yet. A manager must open it in the CMS first." });
    }
    if (isProtectedSite(host)) {
      return answer(422, { code: "PROTECTED", error: `${host} is a protected company website: SED CMS can't change it.` });
    }
    const holder = await siteHolder(admin, host, leadId);
    if (!holder.ok) return answer(500, { error: "The CMS link could not be checked. Try again." });
    if (holder.leadId) return answer(409, { code: "HOST_TAKEN", error: `${host} is already turned on for SED CMS on another lead.` });
    if (confirmHost !== host) {
      const business = businessName?.trim() || "this lead";
      return link
        ? answer(409, {
            code: "CONFIRM_HOST_CHANGE",
            host,
            from: link.host,
            message: `The website address changed from ${link.host} to ${host}. Confirm the new address? The CMS will be able to change this website's files.`,
          })
        : answer(409, {
            code: "CONFIRM_LINK",
            host,
            message: `Turn on SED CMS for ${business} at ${host}? The CMS will be able to change this website's files.`,
          });
    }
    const saved = link ? await moveLink(admin, link, host, user.id) : await createLink(admin, leadId, host, user.id);
    if (!saved.ok) {
      return saved.taken
        ? answer(409, { code: "HOST_TAKEN", error: `${host} is already turned on for SED CMS on another lead.` })
        : answer(500, { error: "The CMS link could not be saved. Try again." });
    }
    const { error: auditError } = await admin.from("activity_log").insert(
      link
        ? { user_id: user.id, action: "sedcms.host_confirmed", entity_type: "lead", entity_id: leadId, old_value: { host: link.host }, new_value: { host } }
        : { user_id: user.id, action: "sedcms.linked", entity_type: "lead", entity_id: leadId, new_value: { host } },
    );
    if (auditError) console.warn(`[sedcms] the ${link ? "sedcms.host_confirmed" : "sedcms.linked"} row for lead ${leadId} was not written`);
  }

  const minted = await mintCmsLink(cfg, { lmsUserId: user.id, leadId });
  if (!minted.ok) {
    if (minted.kind === "unknown_developer") {
      return answer(403, { code: "UNKNOWN_DEVELOPER", error: `Ask Aqib to link your LMS account (your LMS id: ${user.id})` });
    }
    if (minted.kind === "rate_limited") {
      return answer(429, { code: "RATE_LIMITED", error: "Too many CMS sign-in links just now. Try again in a minute." });
    }
    console.warn(`[sedcms] Open in CMS for lead ${leadId} failed: ${minted.detail}`);
    return answer(502, { code: "CMS_UNAVAILABLE", error: "The CMS couldn't be reached. Try again shortly." });
  }

  const { error: logError } = await admin.from("activity_log").insert({
    user_id: user.id,
    action: "cms.opened",
    entity_type: "lead",
    entity_id: leadId,
    new_value: { leadId },
  });
  if (logError) console.warn(`[sedcms] the cms.opened row for lead ${leadId} was not written`);

  return answer(200, { url: minted.url });
}
