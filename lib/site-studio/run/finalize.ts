import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompiledTemplate, ContentDoc } from "../schema";
import { renderSite } from "../render/renderer";
import { zipFromMap } from "../zip";

/** Private bucket for rendered site zips (migration 0053). Phase 4's deploy
 *  handoff reads from here. */
export const SITES_BUCKET = "studio-sites";

export const zipPathFor = (runId: string) => `${runId}/site.zip`;

export type FinalizeOutcome =
  | { ok: true; zipPath: string; zipBytes: number }
  | { ok: false; missing: { page_id: string; slot_id: string }[] };

/**
 * Renders the site FROM SCRATCH — never trusts a prior `render` step's
 * output. Both `render` and `finalize` run while the row is in its
 * post-write phase, and the step machine always routes from there straight
 * to `finalize` (see `nextStep` in `./types` and the engine's own doc
 * comment) — a process that dies mid-render can never be routed back to a
 * bare `render` retry. `render` is pure and both its inputs (the compiled
 * package, the persisted `content_doc`) are durable, so recomputing here is
 * cheap and correct, and it re-applies render's missing-slot refusal —
 * trusting a lost artifact would zip an incoherent site.
 *
 * One storage write on success (upsert: true, so a retried finalize after a
 * partial/failed upload simply overwrites the same key).
 */
export async function finalizeRun(
  admin: SupabaseClient,
  tpl: CompiledTemplate,
  doc: ContentDoc,
  runId: string,
): Promise<FinalizeOutcome> {
  const result = renderSite(tpl, doc);
  if (!result.ok) return { ok: false, missing: result.missing };

  const zipBytes = zipFromMap(result.files);
  const path = zipPathFor(runId);
  const { error } = await admin.storage.from(SITES_BUCKET).upload(path, zipBytes, {
    contentType: "application/zip",
    upsert: true,
  });
  if (error) throw new Error(`finalize: zip upload failed: ${error.message}`);

  return { ok: true, zipPath: path, zipBytes: zipBytes.length };
}
