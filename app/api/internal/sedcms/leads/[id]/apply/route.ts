import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyChanges, decodeChanges, logApply, purgeWritten, withSiteLock } from "@/lib/sedcms/apply";
import { siteFilesFor } from "@/lib/sedcms/files";
import { isUuid, readSignedJson, sedcmsError, sedcmsJson } from "@/lib/sedcms/http";
import { expectHost, loadLead } from "@/lib/sedcms/lead";
import { siteRefusalResponse } from "@/lib/sedcms/read";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

const Change = z
  .object({
    path: z.string().max(1000),
    expectedSha256: z.string().max(128).nullable(),
    contentBase64: z.string(),
  })
  .strict();

const Body = z
  .object({
    host: z.string().max(253),
    requestId: z.string().refine(isUuid),
    changes: z.array(Change).max(1000),
  })
  .strict();

/**
 * POST /api/internal/sedcms/leads/{id}/apply { host, requestId, changes } —
 * SED CMS publishes: write these files to the lead's site, each only if the
 * live file is still the one the CMS expects. Signed by the CMS; no session.
 *
 *   200 { results: [{ path, outcome: written | unchanged, sha256 }], purged }
 *   409 CONFLICT { files: [{ path, expectedSha256, liveSha256 }] } — nothing written
 *   409 HOST_CHANGED { host } — the lead's site moved
 *   422 REFUSED — a path rule, a size, a protected or non-static site
 *   502 HOSTING { results, failed: { path, step } } — what was written before the failure
 *
 * Paths, sizes and base64 are checked before any read; every checksum before
 * any write; one apply at a time per site (lib/sedcms/apply.ts).
 */
export async function POST(req: Request, ctx: Ctx) {
  const signed = await readSignedJson(req, Body);
  if (!signed.ok) return signed.response;
  const { host, requestId, changes } = signed.body;
  const decoded = decodeChanges(changes);
  if (!decoded.ok) return sedcmsError(422, "REFUSED", decoded.message);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const found = await loadLead(admin, id);
  if (!found.ok) return found.response;
  const at = expectHost(found.lead, host);
  if (!at.ok) return at.response;
  if (decoded.changes.length === 0) return sedcmsJson(200, { results: [], purged: false });

  const site = await siteFilesFor(at.host);
  if (!site.ok) return siteRefusalResponse(site, "apply");

  return withSiteLock(site.key, async () => {
    const outcome = await applyChanges(site.files, decoded.changes);
    const paths = decoded.changes.map((c) => c.path);

    if (outcome.kind === "conflict") {
      return sedcmsError(409, "CONFLICT", "A live file is not the one the CMS expected; nothing was written.", { files: outcome.files });
    }

    if (outcome.kind === "failed") {
      const written = outcome.results.filter((r) => r.outcome === "written").map((r) => r.path);
      if (outcome.wrote) await logApply(admin, id, { requestId, host: at.host, paths, outcome: "failed", written, failed: outcome.failed });
      return sedcmsError(502, "HOSTING", `The hosting failed while trying to ${outcome.failed.step} a file.`, {
        results: outcome.results,
        failed: outcome.failed,
      });
    }

    const written = outcome.results.filter((r) => r.outcome === "written").map((r) => r.path);
    const purged = await purgeWritten(admin, id, at.host, written);
    await logApply(admin, id, { requestId, host: at.host, paths, outcome: written.length > 0 ? "applied" : "unchanged", written });
    return sedcmsJson(200, { results: outcome.results, purged });
  });
}
