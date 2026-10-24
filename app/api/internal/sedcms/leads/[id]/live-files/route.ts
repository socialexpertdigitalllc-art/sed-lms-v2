import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteFilesFor } from "@/lib/sedcms/files";
import { READ_DEADLINE_MS, Deadline } from "@/lib/sedcms/deadline";
import { SMALL_REQUEST_BYTES, readSignedJson, sedcmsJson } from "@/lib/sedcms/http";
import { loadLead } from "@/lib/sedcms/lead";
import { linkedHost } from "@/lib/sedcms/links";
import { hostingFailure, liveFiles, siteRefusalResponse } from "@/lib/sedcms/read";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ host: z.string().max(253) }).strict();

/**
 * POST /api/internal/sedcms/leads/{id}/live-files { host } — what is live on
 * the lead's site, for the CMS's importer: every file's path and size, and
 * the text and sha256 of its text files (1 MiB each, 25 MiB in all).
 * Signed by the CMS; no session. Only the host SED CMS is linked at
 * (lib/sedcms/links.ts): 404 NO_LEAD for a lead it isn't turned on for, 409
 * HOST_CHANGED when that isn't `host` or the lead's site moved since; 403
 * PROTECTED, 422 NOT_STATIC, 502 HOSTING.
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
  const signed = await readSignedJson(req, Body, SMALL_REQUEST_BYTES);
  if (!signed.ok) return signed.response;
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const found = await loadLead(admin, id);
  if (!found.ok) return found.response;
  const at = await linkedHost(admin, found.lead, signed.body.host);
  if (!at.ok) return at.response;

  const site = await siteFilesFor(at.host);
  if (!site.ok) return siteRefusalResponse(site);
  try {
    const live = await liveFiles(site.files, { deadline });
    return sedcmsJson(200, { host: at.host, files: live.files, truncated: live.truncated });
  } catch (e) {
    return hostingFailure(e, null);
  }
}
