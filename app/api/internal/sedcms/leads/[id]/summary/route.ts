import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSignedJson, sedcmsError, sedcmsJson } from "@/lib/sedcms/http";
import { leadSummary, loadLead } from "@/lib/sedcms/lead";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({}).strict();

/**
 * POST /api/internal/sedcms/leads/{id}/summary — SED CMS asks about a lead
 * before linking a site to it: its name, email, status, and where its site
 * lives (host, staging or custom, and whether the LMS can edit it as static
 * files). Signed by the CMS (lib/sedcms/signature.ts); no session. A deleted
 * lead is a 404 NO_LEAD.
 */
export async function POST(req: Request, ctx: Ctx) {
  const signed = await readSignedJson(req, Body);
  if (!signed.ok) return signed.response;
  const { id } = await ctx.params;

  const found = await loadLead(createAdminClient(), id);
  if (!found.ok) return found.response;

  const summary = await leadSummary(found.lead);
  if (!summary) return sedcmsError(502, "HOSTING", "The hosting could not be reached.");
  return sedcmsJson(200, summary);
}
