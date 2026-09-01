// lib/site-agent/resultCache.ts
/** Unzipped file maps for review-screen serving, TTL-cached per process so a
 *  2s-polling review screen doesn't re-download+unzip the bucket zips on
 *  every asset request. 60s staleness is fine: zips only change when a run
 *  transitions, and transitions bump updated_at — a version mismatch below
 *  refreshes immediately, the TTL only bounds redundant downloads. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ttlCached, ttlInvalidate } from "@/lib/cache/ttl";
import { unzipToMap } from "@/lib/template-engine/zip";
import { AGENT_SITES_BUCKET, originalZipPath, resultZipPath } from "./types";

type VersionedMap = { version: string; map: Record<string, Uint8Array> | null };

/** Key deliberately EXCLUDES the version: one live entry per (run, side),
 *  overwritten in place when the run transitions, so stale multi-MB maps
 *  can't accumulate for the life of the process (ttlCached never evicts
 *  orphaned keys — see the review note on 2026-09-01). The version lives in
 *  the VALUE instead; a mismatch invalidates and reloads. */
export async function loadRunMap(
  admin: SupabaseClient, runId: string, which: "original" | "result", version: string,
): Promise<Record<string, Uint8Array> | null> {
  const key = `${runId}:${which}`;
  const load = () => ttlCached<VersionedMap>("site-agent-zip", key, 60_000, async () => {
    const path = which === "original" ? originalZipPath(runId) : resultZipPath(runId);
    const { data } = await admin.storage.from(AGENT_SITES_BUCKET).download(path);
    return { version, map: data ? unzipToMap(new Uint8Array(await data.arrayBuffer())) : null };
  });
  let entry = await load();
  if (entry.version !== version) {
    ttlInvalidate("site-agent-zip", key);
    entry = await load();
  }
  return entry.map;
}
