// lib/site-agent/resultCache.ts
/** Unzipped file maps for review-screen serving, TTL-cached per process so a
 *  2s-polling review screen doesn't re-download+unzip the bucket zips on
 *  every asset request. 60s staleness is fine: zips only change when a run
 *  transitions, and transitions bump updated_at which is part of the key. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ttlCached } from "@/lib/cache/ttl";
import { unzipToMap } from "@/lib/template-engine/zip";
import { AGENT_SITES_BUCKET, originalZipPath, resultZipPath } from "./types";

export async function loadRunMap(
  admin: SupabaseClient, runId: string, which: "original" | "result", version: string,
): Promise<Record<string, Uint8Array> | null> {
  return ttlCached("site-agent-zip", `${runId}:${which}:${version}`, 60_000, async () => {
    const path = which === "original" ? originalZipPath(runId) : resultZipPath(runId);
    const { data } = await admin.storage.from(AGENT_SITES_BUCKET).download(path);
    if (!data) return null;
    return unzipToMap(new Uint8Array(await data.arrayBuffer()));
  });
}
