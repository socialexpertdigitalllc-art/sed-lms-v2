/**
 * Image-slot types + pure ranking/merge helpers (Phase 2, spec §4/§7).
 *
 * A slot is one image "hole" in the site (hero, one per service, gallery,
 * about). Candidates are gathered from Pexels (+ the client's own photos) and
 * ranked by a Gemini vision pass (see vision.ts) before the operator picks.
 * This module owns the shapes both the vision pass and the gather/curation
 * layers share, and the pure decision logic (ranking, trimming, merging) that
 * needs no network access and is fully unit-testable.
 */

/**
 * One vision model's verdict on a single candidate image. `people` is the
 * hard gate (spec §7: default-drop any photo showing a person or body part);
 * `relevance`/`quality` are 0-1 scores used to rank what survives. Owned here
 * (not vision.ts) so ImageCandidate has a single source of truth for the shape
 * — vision.ts imports this type rather than redeclaring it.
 */
export interface VisionVerdict {
  people: boolean;
  relevance: number;
  quality: number;
  reason: string;
}

export interface ImageCandidate {
  url: string;
  thumb: string;
  source: "pexels" | "custom" | "client";
  photographer?: string;
  width?: number;
  height?: number;
  vision?: VisionVerdict;
  pexelsId?: number;
}

export interface ImageSlot {
  id: string; // = the brief's slot_id
  kind: string; // hero | service | gallery | about
  label: string;
  pick_max: number; // hero 3, else 1
  present_max: number; // hero 6, service 5
  candidates: ImageCandidate[];
  selected: string[]; // chosen urls (<= pick_max)
  seen_pexels_ids: number[]; // powers "show different ones"
}

/** Hero slots get a bigger gallery + multi-pick; every other kind is single-pick. */
export function slotDefaults(kind: string): { pick_max: number; present_max: number } {
  if (kind === "hero") return { pick_max: 3, present_max: 6 };
  return { pick_max: 1, present_max: 5 };
}

/** relevance*quality, with "no vision verdict at all" scored lower than any real verdict (incl. an honest 0). */
function rankScore(c: ImageCandidate): number {
  if (!c.vision) return -1;
  return (c.vision.relevance ?? 0) * (c.vision.quality ?? 0);
}

/**
 * Drop people-showing candidates (per `excludePeople`), rank the rest by
 * vision score, and trim to `presentMax`. Client-sourced candidates (the
 * business's own real photo) are a special case: never dropped by the vision
 * gate and always sorted first, because a real client photo always wins.
 */
export function rankAndTrim(
  candidates: ImageCandidate[],
  opts: { excludePeople: boolean; presentMax: number },
): ImageCandidate[] {
  const client = candidates.filter((c) => c.source === "client");
  const rest = candidates
    .filter((c) => c.source !== "client")
    .filter((c) => !(opts.excludePeople && c.vision?.people === true));

  const rankedRest = rest
    .map((c, i) => ({ c, i, s: rankScore(c) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c);

  return [...client, ...rankedRest].slice(0, opts.presentMax);
}

/** Union two candidate lists by `url`, existing first — so "show more" appends without duplicating. */
export function mergeCandidates(existing: ImageCandidate[], fresh: ImageCandidate[]): ImageCandidate[] {
  const seen = new Set(existing.map((c) => c.url));
  const merged = [...existing];
  for (const c of fresh) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    merged.push(c);
  }
  return merged;
}
