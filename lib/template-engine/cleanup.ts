// Best-effort removal of a generation's build artefacts.
//
// This is the honest cost of stopping immediately. A cancel can now land in the
// middle of `finalize` — between the zip upload and the per-file explode, or
// part-way through the explode itself — which leaves objects under
// `template-sites/<generationId>/` that describe a site that was never
// finished. Nothing must ever serve or deploy those (the download route reads
// `zip_path`, the deploy route downloads it), so a cancel deletes them and the
// caller nulls `zip_path` in the same breath.
//
// PAUSE NEVER CALLS THIS. A paused run has to stay resumable, and the build
// phase re-uploads with `upsert: true` anyway, so leftovers are overwritten
// rather than orphaned.

import type { SupabaseClient } from "@supabase/supabase-js";
import { listStorageFiles } from "./runner";

const SITES_BUCKET = "template-sites";

/** Supabase storage caps a remove() call; delete in chunks so a big site still clears. */
const REMOVE_BATCH = 100;

/**
 * Delete everything this generation wrote to `template-sites` — the zip and
 * every exploded per-file object under its prefix. Never throws: a cancel is
 * recorded whether or not the bucket cooperated, because a run the operator
 * stopped must not stay `building` because a delete 500'd. Returns how many
 * paths were handed to the bucket, for the log line.
 */
export async function removeGenerationArtifacts(
  admin: SupabaseClient,
  generationId: string,
): Promise<{ removed: number; ok: boolean }> {
  try {
    const listed = await listStorageFiles(admin, SITES_BUCKET, generationId);
    // The zip is included explicitly: a run aborted mid-upload may have written
    // it after the listing, and remove() on a missing path is harmless.
    const paths = [...new Set([...listed, `${generationId}/site.zip`])];
    if (paths.length === 0) return { removed: 0, ok: true };
    let ok = true;
    for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
      const { error } = await admin.storage.from(SITES_BUCKET).remove(paths.slice(i, i + REMOVE_BATCH));
      if (error) ok = false;
    }
    return { removed: paths.length, ok };
  } catch {
    return { removed: 0, ok: false };
  }
}
