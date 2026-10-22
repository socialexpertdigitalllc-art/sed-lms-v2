import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteFilesFor } from "@/lib/sedcms/files";
import { readSignedJson, sedcmsError, sedcmsJson } from "@/lib/sedcms/http";
import { expectHost, loadLead } from "@/lib/sedcms/lead";
import { cmsPathAllowed } from "@/lib/sedcms/paths";
import { CHECKSUMS_MAX_PATHS, checksums, hostingFailure, siteRefusalResponse } from "@/lib/sedcms/read";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ host: z.string().max(253), paths: z.array(z.string().max(1000)).max(1000) }).strict();

/**
 * POST /api/internal/sedcms/leads/{id}/checksums { host, paths } — the live
 * sha256 of each path (null: no such file), at most 100, for the CMS's
 * "Check" after a publish that ended with no outcome. Signed by the CMS; no
 * session. Every path must pass the shared path rules (422 REFUSED, before
 * any hosting call); 409 HOST_CHANGED when the lead's site moved.
 */
export async function POST(req: Request, ctx: Ctx) {
  const signed = await readSignedJson(req, Body);
  if (!signed.ok) return signed.response;
  const { host, paths } = signed.body;
  if (paths.length > CHECKSUMS_MAX_PATHS) return sedcmsError(422, "REFUSED", `At most ${CHECKSUMS_MAX_PATHS} paths at once.`);
  if (!paths.every((p) => cmsPathAllowed(p))) return sedcmsError(422, "REFUSED", "A path is not one the CMS may read.");
  const { id } = await ctx.params;

  const found = await loadLead(createAdminClient(), id);
  if (!found.ok) return found.response;
  const at = expectHost(found.lead, host);
  if (!at.ok) return at.response;

  const site = await siteFilesFor(at.host);
  if (!site.ok) return siteRefusalResponse(site);
  try {
    return sedcmsJson(200, { files: await checksums(site.files, paths) });
  } catch (e) {
    return hostingFailure(e, null);
  }
}
