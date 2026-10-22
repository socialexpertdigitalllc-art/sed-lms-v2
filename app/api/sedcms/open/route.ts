import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { cmsConfig, mintCmsLink } from "@/lib/sedcms/cms";
import { isUuid } from "@/lib/sedcms/http";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Who may open a lead's site in the CMS: the people who may overwrite it. */
const ALLOWED_PERMS = ["studio.manage", "tickets.resolve"];

const Body = z.object({ leadId: z.string().refine(isUuid) }).strict();

const answer = (status: number, body: Record<string, unknown>) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * POST /api/sedcms/open { leadId } — "Open in CMS" on a lead or a ticket.
 * With the developer's own session: the LMS asks SED CMS for a one-time
 * sign-in link for that developer's own CMS account, about this lead
 * (lib/sedcms/cms.ts), and answers { url } for the browser to follow. The
 * link must be on SEDCMS_URL's own address: the LMS never sends anyone
 * anywhere else. It is never logged.
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
  const { leadId } = parsed;

  // RLS-scoped: a lead this user can't see is a 404.
  const { data: lead } = await supabase.from("leads").select("id").eq("id", leadId).is("deleted_at", null).maybeSingle();
  if (!lead) return answer(404, { error: "Lead not found" });

  const cfg = cmsConfig();
  if (!cfg.ok) {
    console.error(`[sedcms] Open in CMS is off: ${cfg.reason}`);
    return answer(503, { code: "CMS_NOT_CONNECTED", error: "The CMS isn't connected to the LMS yet." });
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

  const { error: logError } = await createAdminClient().from("activity_log").insert({
    user_id: user.id,
    action: "cms.opened",
    entity_type: "lead",
    entity_id: leadId,
    new_value: { leadId },
  });
  if (logError) console.warn(`[sedcms] the cms.opened row for lead ${leadId} was not written`);

  return answer(200, { url: minted.url });
}
