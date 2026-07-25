import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompiledTemplate, ContentDoc } from "../schema";
import { renderSite } from "../render/renderer";
import { zipFromMap } from "../zip";
import { resolveAssets, type ResolveAssetsDeps } from "./resolveAssets";

/** Private bucket for rendered site zips (migration 0053). Phase 4's deploy
 *  handoff reads from here. */
export const SITES_BUCKET = "studio-sites";

export const zipPathFor = (runId: string) => `${runId}/site.zip`;

export type FinalizeOutcome =
  | { ok: true; zipPath: string; zipBytes: number }
  | { ok: false; missing: { page_id: string; slot_id: string }[] }
  | { ok: false; missingAssets: string[] };

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
 * BEFORE rendering, every `asset:{uuid}` slot value (and every still-bare
 * template-relative image sample the operator never touched) is resolved to
 * a real, depth-correct relative path via `resolveAssets` — the renderer
 * itself drops an image slot's value in verbatim with no depth adjustment
 * (see resolveAssets.ts's own doc comment for the probe that found this), so
 * this MUST happen before `renderSite`, not after. A picked asset that fails
 * to load is a hard refusal: a deployed site must never carry a dangling
 * `asset:` reference, so this is checked (and fails the run, naming the
 * asset ids) even before the ordinary render completeness check runs.
 *
 * `deps.loadAssetBytes` is optional so callers that never pick an image
 * (or 3a-era call sites) don't have to supply a loader; a doc with zero
 * `asset:` slot values never invokes it.
 *
 * One storage write on success (upsert: true, so a retried finalize after a
 * partial/failed upload simply overwrites the same key).
 */
export async function finalizeRun(
  admin: SupabaseClient,
  tpl: CompiledTemplate,
  doc: ContentDoc,
  runId: string,
  assetDeps?: ResolveAssetsDeps,
): Promise<FinalizeOutcome> {
  const loadAssetBytes = assetDeps?.loadAssetBytes ?? (async () => null);
  const resolved = await resolveAssets({ loadAssetBytes }, tpl.manifest, doc);
  if (resolved.missing.length > 0) return { ok: false, missingAssets: resolved.missing };

  const result = renderSite(tpl, resolved.doc);
  if (!result.ok) return { ok: false, missing: result.missing };

  const files = { ...result.files, ...resolved.files };
  const zipBytes = zipFromMap(files);
  const path = zipPathFor(runId);
  const { error } = await admin.storage.from(SITES_BUCKET).upload(path, zipBytes, {
    contentType: "application/zip",
    upsert: true,
  });
  if (error) throw new Error(`finalize: zip upload failed: ${error.message}`);

  return { ok: true, zipPath: path, zipBytes: zipBytes.length };
}
