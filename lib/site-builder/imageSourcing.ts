import type { SupabaseClient } from "@supabase/supabase-js";
import type { PexelsResult } from "@/lib/site-studio/assets/pexels";
import { searchLibrary } from "@/lib/site-studio/assets/library";
import type { ImageNeed } from "./imageNeeds";

/** One sourced option for a need, cheap-filtered only (dimensions, dedupe) —
 *  no vision AI, no ranking. `key` is stable and unique across the whole
 *  response, for React keys and for matching a UI pick back to what to
 *  rehost. Library candidates carry `thumb_path` (a private-bucket storage
 *  path — the route resolves it to a signed `thumb_url`); Pexels candidates
 *  already carry a hot-linked `thumb_url` straight from Pexels — nothing is
 *  rehosted until the operator's pick is actually used on Generate. */
export type SourcedCandidate =
  | { kind: "library"; key: string; asset_id: string; thumb_path: string; width: number; height: number }
  | {
      kind: "pexels";
      key: string;
      pexels_id: number;
      thumb_url: string;
      download_url: string;
      width: number;
      height: number;
      photographer: string;
    };

export interface SourcedNeed {
  purpose: string;
  query: string;
  candidates: SourcedCandidate[];
  /** Set only when Pexels itself failed for this need (network error, rate
   *  limit, missing key, ...) — the need still comes back with whatever
   *  library candidates it found, never a thrown error. Null when Pexels
   *  either wasn't needed (library already met the top-up threshold) or
   *  succeeded. */
  pexelsError: string | null;
}

export interface SourceImagesDeps {
  admin: SupabaseClient;
  searchPexels: (query: string) => Promise<PexelsResult>;
}

// Same thresholds as the old slot-based sourcer (lib/site-studio/run/imageSource.ts)
// — carried over deliberately, not re-tuned, so behaviour an operator already
// knows from Site Studio doesn't shift underfoot.
const LIBRARY_TOPUP_THRESHOLD = 4;
const CANDIDATE_CAP = 9;
const MIN_WIDTH = 1200;
const MIN_HEIGHT = 800;

/**
 * Auto-source candidates for every image need in one pass: library first
 * (already rehosted, zero risk), Pexels only as a top-up when the library
 * falls short, cheap dimension filtering only. Candidates are deduped
 * GLOBALLY across every need (not just within one) so two needs never offer
 * the same photo — a stock photo good for "Hero" showing up again under
 * "About" is a UI wart, not a feature. Needs are processed in order so that
 * dedupe is deterministic for a given input.
 *
 * Sourcing is an enhancement to the run, never a cause of its failure: a
 * Pexels outage on one need degrades that need to fewer/no candidates
 * (`pexelsError` set) and never touches the others.
 */
export async function sourceImagesForNeeds(
  deps: SourceImagesDeps,
  needs: ImageNeed[],
  leadId: string | null,
): Promise<SourcedNeed[]> {
  const seenLibraryIds = new Set<string>();
  const seenPexelsIds = new Set<number>();
  const out: SourcedNeed[] = [];

  for (const need of needs) {
    const candidates: SourcedCandidate[] = [];

    try {
      const rows = await searchLibrary(deps.admin, { subject: need.query, leadId: leadId ?? undefined });
      for (const r of rows) {
        if (seenLibraryIds.has(r.id)) continue;
        seenLibraryIds.add(r.id);
        candidates.push({
          kind: "library",
          key: `library:${r.id}`,
          asset_id: r.id,
          thumb_path: r.storage_path,
          width: r.width,
          height: r.height,
        });
      }
    } catch {
      // Library search is best-effort here too — an outage degrades to
      // "no library candidates for this need", same posture as Pexels below.
    }

    let pexelsError: string | null = null;
    if (candidates.length < LIBRARY_TOPUP_THRESHOLD && need.query.trim()) {
      let result: PexelsResult;
      try {
        result = await deps.searchPexels(need.query);
      } catch (e) {
        result = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      if (result.ok) {
        for (const p of result.candidates) {
          if (candidates.length >= CANDIDATE_CAP) break;
          if (p.width < MIN_WIDTH || p.height < MIN_HEIGHT) continue;
          if (seenPexelsIds.has(p.pexels_id)) continue;
          seenPexelsIds.add(p.pexels_id);
          candidates.push({
            kind: "pexels",
            key: `pexels:${p.pexels_id}`,
            pexels_id: p.pexels_id,
            thumb_url: p.thumb_url,
            download_url: p.download_url,
            width: p.width,
            height: p.height,
            photographer: p.photographer,
          });
        }
      } else {
        pexelsError = result.error;
      }
    }

    out.push({
      purpose: need.purpose,
      query: need.query,
      candidates: candidates.slice(0, CANDIDATE_CAP),
      pexelsError,
    });
  }

  return out;
}
