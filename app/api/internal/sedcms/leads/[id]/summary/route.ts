import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSignedJson, sedcmsError, sedcmsJson } from "@/lib/sedcms/http";
import { leadSummary, loadLead } from "@/lib/sedcms/lead";
import { linkedHost } from "@/lib/sedcms/links";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({}).strict();

/**
 * POST /api/internal/sedcms/leads/{id}/summary — SED CMS asks about a lead
 * before linking a site to it: its name, email, status, and where its site
 * lives (the host a manager turned SED CMS on at, staging or custom, and
 * whether the LMS can edit it as static files). Signed by the CMS
 * (lib/sedcms/signature.ts); no session. A deleted lead, or one SED CMS isn't
 * turned on for, is a 404 NO_LEAD; one whose address changed since is a 409
 * HOST_CHANGED (lib/sedcms/links.ts).
 */
export async function POST(req: Request, ctx: Ctx) {
  const signed = await readSignedJson(req, Body);
  if (!signed.ok) return signed.response;
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const found = await loadLead(admin, id);
  if (!found.ok) return found.response;
  const at = await linkedHost(admin, found.lead);
  if (!at.ok) return at.response;

  const summary = await leadSummary(found.lead, at.host);
  if (!summary) return sedcmsError(502, "HOSTING", "The hosting could not be reached.");
  return sedcmsJson(200, summary);
}
