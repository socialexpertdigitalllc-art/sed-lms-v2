import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyChanges, decodeChanges, logApply, purgeWritten, withSiteLock } from "@/lib/sedcms/apply";
import { APPLY_DEADLINE_MS, Deadline } from "@/lib/sedcms/deadline";
import { siteFilesFor } from "@/lib/sedcms/files";
import { isUuid, readSignedJson, sedcmsError, sedcmsJson } from "@/lib/sedcms/http";
import { loadLead } from "@/lib/sedcms/lead";
import { linkedHost } from "@/lib/sedcms/links";
import { siteRefusalResponse } from "@/lib/sedcms/read";

export const runtime = "nodejs";
// Not enforced by a self-hosted Next.js: the apply's own deadline is.
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
 *   404 NO_LEAD — no such lead, or SED CMS isn't turned on for it
 *   409 HOST_CHANGED { host } — not the host SED CMS is linked at, or the
 *       lead's site moved since (lib/sedcms/links.ts)
 *   422 REFUSED — a path rule, a size, a protected or non-static site
 *   502 HOSTING { results, failed: { path, step } } — what was written before
 *       a host failed, or before the deadline stopped the apply
 *
 * Paths, sizes and base64 are checked before any read; every checksum before
 * any write; one apply at a time per site (lib/sedcms/apply.ts). No host call
 * starts after 240 s from when this request was accepted, lock wait included,
 * and each has its own 30 s (lib/sedcms/deadline.ts): the apply's last host
 * call ends within 300 s, inside the CMS's publish lease.
 */
export async function POST(req: Request, ctx: Ctx) {
  const deadline = new Deadline(Date.now() + APPLY_DEADLINE_MS);
  try {
    return await applyWithin(req, ctx, deadline);
  } finally {
    deadline.dispose();
  }
}

async function applyWithin(req: Request, ctx: Ctx, deadline: Deadline) {
  const signed = await readSignedJson(req, Body);
  if (!signed.ok) return signed.response;
  const { host, requestId, changes } = signed.body;
  const decoded = decodeChanges(changes);
  if (!decoded.ok) return sedcmsError(422, "REFUSED", decoded.message);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const found = await loadLead(admin, id);
  if (!found.ok) return found.response;
  const at = await linkedHost(admin, found.lead, host);
  if (!at.ok) return at.response;
  if (decoded.changes.length === 0) return sedcmsJson(200, { results: [], purged: false });

  const site = await siteFilesFor(at.host);
  if (!site.ok) return siteRefusalResponse(site, "apply");

  return withSiteLock(site.key, async () => {
    const outcome = await applyChanges(site.files, decoded.changes, { deadline });
    const paths = decoded.changes.map((c) => c.path);

    if (outcome.kind === "conflict") {
      return sedcmsError(409, "CONFLICT", "A live file is not the one the CMS expected; nothing was written.", { files: outcome.files });
    }

    if (outcome.kind === "failed") {
      const written = outcome.results.filter((r) => r.outcome === "written").map((r) => r.path);
      if (outcome.wrote) {
        await logApply(admin, id, {
          requestId,
          host: at.host,
          paths,
          outcome: "failed",
          written,
          failed: outcome.failed,
          ...(outcome.cut ? { timedOut: true as const } : {}),
        });
      }
      const message = outcome.cut
        ? "The apply ran out of time: the files in results were written, the rest were not."
        : `The hosting failed while trying to ${outcome.failed.step} a file.`;
      // A cut apply is never purged: the CMS's "Check" settles it first.
      return sedcmsError(502, "HOSTING", message, { results: outcome.results, failed: outcome.failed });
    }

    const written = outcome.results.filter((r) => r.outcome === "written").map((r) => r.path);
    const purged = await purgeWritten(admin, id, at.host, written, deadline);
    await logApply(admin, id, { requestId, host: at.host, paths, outcome: written.length > 0 ? "applied" : "unchanged", written });
    return sedcmsJson(200, { results: outcome.results, purged });
  });
}
