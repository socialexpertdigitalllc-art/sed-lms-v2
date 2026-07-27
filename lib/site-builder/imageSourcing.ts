import type { SupabaseClient } from "@supabase/supabase-js";
import type { PexelsResult } from "@/lib/site-studio/assets/pexels";
import { searchLibrary } from "@/lib/site-studio/assets/library";
import type { ImageNeedsResult } from "./imageNeeds";

/** One sourced option, cheap-filtered only (dimensions, dedupe) — no vision
 *  AI, no ranking (that's a separate pass — see `imageRank.ts` — applied by
 *  the route, not here). `key` is stable and unique across the whole
 *  response, for React keys and for matching a UI pick back to what to
 *  rehost. Library candidates carry `thumb_path` (a private-bucket storage
 *  path — the route resolves it to a signed `thumb_url`); Pexels candidates
 *  already carry a hot-linked `thumb_url` straight from Pexels; a `client`
 *  candidate is one of the lead's OWN `image_links`, untouched — none of
 *  these are rehosted until the operator's pick is actually used on
 *  Generate. */
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
    }
  | { kind: "client"; key: string; url: string };

export interface ServiceSourcedRow {
  service: string;
  /** The exact label carried through to the run's `images[].purpose`. */
  purpose: string;
  query: string;
  /** Up to ROW_CANDIDATE_COUNT (3) — the operator picks exactly one. */
  candidates: SourcedCandidate[];
  /** Set only when Pexels itself failed for this row (network error, rate
   *  limit, missing key, ...) — the row still comes back with whatever
   *  library candidates it found, never a thrown error. */
  pexelsError: string | null;
}

export interface SourcedImages {
  /** Up to HERO_TARGET (5) — the operator picks up to 3 (enforced in the
   *  UI, see NewSiteFlow.tsx). Composed from the first HERO_SERVICE_COUNT
   *  (3) service searches plus the lead's own photos — see the doc comment
   *  on `sourceImages` for the exact composition. */
  hero: SourcedCandidate[];
  services: ServiceSourcedRow[];
  servicesTruncated: boolean;
  droppedServices: string[];
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

/** "Hero gets one from each of the first 3 services" — literally the operator's spec. */
const HERO_SERVICE_COUNT = 3;
/** "I want a total of 5 images, from which i'll choose 3." */
const HERO_TARGET = 5;
/** "each service should have 3 options from which i can choose 1" */
const ROW_CANDIDATE_COUNT = 3;

/** Search one service's bare name against the library, then Pexels as a
 *  top-up, applying the cheap dimension filter and the GLOBAL dedupe sets
 *  (shared across every service so the same photo never surfaces under two
 *  different services). Never throws — a failure degrades to fewer
 *  candidates for THIS service only. */
async function sourceOneService(
  deps: SourceImagesDeps,
  query: string,
  leadId: string | null,
  seenLibraryIds: Set<string>,
  seenPexelsIds: Set<number>,
): Promise<{ candidates: SourcedCandidate[]; pexelsError: string | null }> {
  const candidates: SourcedCandidate[] = [];

  try {
    const rows = await searchLibrary(deps.admin, { subject: query, leadId: leadId ?? undefined });
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
    // Library search is best-effort — an outage degrades to "no library
    // candidates for this service", same posture as Pexels below.
  }

  let pexelsError: string | null = null;
  if (candidates.length < LIBRARY_TOPUP_THRESHOLD && query.trim()) {
    let result: PexelsResult;
    try {
      result = await deps.searchPexels(query);
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

  return { candidates: candidates.slice(0, CANDIDATE_CAP), pexelsError };
}

/**
 * Source Hero and every Service row in one pass, per the operator's exact
 * spec:
 *
 * HERO — up to 5 candidates, composed (never independently searched) from:
 *   - one from each of the first HERO_SERVICE_COUNT (3) services' own
 *     searches — the single best (first) result of each, claimed straight
 *     off that service's pool so its own row never repeats it (global
 *     dedupe across rows, same invariant as before);
 *   - one of the lead's own `clientPhotoUrls`, if it has any;
 *   - topped up to exactly HERO_TARGET (5) with the next-best UNUSED
 *     results from those SAME service searches — so with a client photo:
 *     3 (services) + 1 (client) + 1 filler; without: 3 + 2 fillers — pulled
 *     round-robin across whichever of the (up to 3) hero services still
 *     have leftovers, so a lead with fewer than 3 services simply spreads
 *     the fill across however many it has. A lead with zero services (or
 *     whose searches turned up nothing at all) just gets fewer than 5 —
 *     never a crash, never a forced pad.
 *
 * SERVICE ROWS — up to ROW_CANDIDATE_COUNT (3) each, one row per service in
 * `needs.services`. Whichever of the first 3 fed Hero shows its NEXT 3
 * results (Hero already claimed the first); every other row shows its own
 * first 3 — the operator picks exactly one per row.
 *
 * Never throws: every failure (library outage, Pexels outage, no results at
 * all) degrades to fewer candidates for the row it happened on, exactly like
 * the sourcer this replaces.
 */
export async function sourceImages(
  deps: SourceImagesDeps,
  needs: ImageNeedsResult,
  leadId: string | null,
  clientPhotoUrls: string[],
): Promise<SourcedImages> {
  const seenLibraryIds = new Set<string>();
  const seenPexelsIds = new Set<number>();

  // Raw per-service pools, sourced in row order so the global dedupe sets
  // above are deterministic for a given input (a service later in the list
  // never steals a photo a earlier one already claimed).
  const pools: SourcedCandidate[][] = [];
  const pexelsErrors: (string | null)[] = [];
  for (const svc of needs.services) {
    const { candidates, pexelsError } = await sourceOneService(deps, svc.query, leadId, seenLibraryIds, seenPexelsIds);
    pools.push(candidates);
    pexelsErrors.push(pexelsError);
  }

  // ---- Hero: one claim per of the first HERO_SERVICE_COUNT services ----
  const heroServiceCount = Math.min(HERO_SERVICE_COUNT, pools.length);
  const hero: SourcedCandidate[] = [];
  for (let i = 0; i < heroServiceCount; i++) {
    const claim = pools[i].shift(); // removes it so that service's own row never repeats it
    if (claim) hero.push(claim);
  }

  // ---- + one of the lead's own photos, if any ----
  const clientPhoto = clientPhotoUrls.find((u) => u && u.trim());
  if (clientPhoto) hero.push({ kind: "client", key: `client:${clientPhoto}`, url: clientPhoto });

  // ---- Service rows: whatever's left in each pool after Hero's claim ----
  const services: ServiceSourcedRow[] = needs.services.map((svc, i) => ({
    service: svc.service,
    purpose: `Service: ${svc.service}`,
    query: svc.query,
    candidates: pools[i].splice(0, ROW_CANDIDATE_COUNT), // mutates pools[i], leaving only filler leftovers
    pexelsError: pexelsErrors[i],
  }));

  // ---- Hero fillers: round-robin the leftover of the SAME hero services,
  // "next best unused", until Hero reaches 5 or every one of them is spent.
  let need = HERO_TARGET - hero.length;
  if (need > 0 && heroServiceCount > 0) {
    let idx = 0;
    let missesInARow = 0;
    while (need > 0 && missesInARow < heroServiceCount) {
      const svcIdx = idx % heroServiceCount;
      idx++;
      const next = pools[svcIdx].shift();
      if (next) {
        hero.push(next);
        need--;
        missesInARow = 0;
      } else {
        missesInARow++;
      }
    }
  }

  return {
    hero: hero.slice(0, HERO_TARGET),
    services,
    servicesTruncated: needs.servicesTruncated,
    droppedServices: needs.droppedServices,
  };
}
