import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteFilesFor } from "@/lib/sedcms/files";
import { READ_DEADLINE_MS, Deadline } from "@/lib/sedcms/deadline";
import { readSignedJson, sedcmsError, sedcmsJson } from "@/lib/sedcms/http";
import { loadLead } from "@/lib/sedcms/lead";
import { linkedHost } from "@/lib/sedcms/links";
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
 * any hosting call). Only the host SED CMS is linked at (lib/sedcms/links.ts):
 * 404 NO_LEAD, or 409 HOST_CHANGED when that isn't `host` or the site moved.
 */
export async function POST(req: Request, ctx: Ctx) {
  // No host call starts after 100 s, under the CMS's 120 s (lib/sedcms/deadline.ts).
  const deadline = new Deadline(Date.now() + READ_DEADLINE_MS);
  try {
    return await readWithin(req, ctx, deadline);
  } finally {
    deadline.dispose();
  }
}

async function readWithin(req: Request, ctx: Ctx, deadline: Deadline) {
  const signed = await readSignedJson(req, Body);
  if (!signed.ok) return signed.response;
  const { host, paths } = signed.body;
  if (paths.length > CHECKSUMS_MAX_PATHS) return sedcmsError(422, "REFUSED", `At most ${CHECKSUMS_MAX_PATHS} paths at once.`);
  if (!paths.every((p) => cmsPathAllowed(p))) return sedcmsError(422, "REFUSED", "A path is not one the CMS may read.");
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const found = await loadLead(admin, id);
  if (!found.ok) return found.response;
  const at = await linkedHost(admin, found.lead, host);
  if (!at.ok) return at.response;

  const site = await siteFilesFor(at.host);
  if (!site.ok) return siteRefusalResponse(site);
  try {
    return sedcmsJson(200, { files: await checksums(site.files, paths, { deadline }) });
  } catch (e) {
    return hostingFailure(e, null);
  }
}
