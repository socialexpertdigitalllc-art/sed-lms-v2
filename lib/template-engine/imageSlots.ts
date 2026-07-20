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
  source: "pexels" | "custom" | "client" | "curated";
  photographer?: string;
  width?: number;
  height?: number;
  vision?: VisionVerdict;
  pexelsId?: number;
  /**
   * The search query that actually produced this candidate. Optional and
   * absent on every pre-existing slot: a gather may fall back from the brief's
   * specific query to the broad businessType one (gatherImages.ts), and the
   * operator deserves to know which of the two a photo came from.
   */
  query?: string;
}

/**
 * What ONE Pexels page + vision pass actually did. The whole point is that
 * "no candidates" and "twelve found, eleven of them had people in" are wildly
 * different situations that used to look identical in the UI.
 */
export interface GatherAttempt {
  query: string; // the query this attempt actually searched
  broadened: boolean; // true when it was the businessType fallback, not the brief's query
  page: number;
  fetched: number; // photos Pexels returned
  alreadySeen: number; // dropped because this slot has already shown them
  rejectedByVision: number; // dropped by the people gate (or an unreadable verdict)
  trimmed: number; // survived vision but didn't fit the slot's present_max
  kept: number; // actually handed to the operator
}

/** Sum of every attempt in one gather (one click = possibly several pages/queries). */
export interface GatherStats extends Omit<GatherAttempt, "query" | "broadened" | "page"> {
  pages: number; // Pexels pages consumed
  queries: string[]; // every distinct query tried, in order
  broadened: boolean; // true when the broad businessType fallback was used at all
  timedOut: boolean; // true when the time budget, not the page budget, ended the loop
  attempts: GatherAttempt[];
}

export interface ImageSlot {
  id: string; // = the brief's slot_id
  kind: string; // hero | service | gallery | about
  label: string;
  pick_max: number; // hero 3, else 1
  present_max: number; // hero 6, service 5
  candidates: ImageCandidate[];
  selected: string[]; // chosen urls (<= pick_max)
  seen_pexels_ids: number[]; // powers "show different ones" (belt-and-suspenders with paging)
  next_page?: number; // next Pexels page to fetch on "show more" (Task 5's /more increments it)
  /**
   * Per-slot override of the generation-wide `exclude_people` option. Absent on
   * every slot written before this field existed, so it MUST be read through
   * `slotExcludesPeople()` (undefined = inherit the generation), never assumed
   * present. `true` lets one slot (a team/about shot, a niche trade with no
   * people-free stock at all) keep people without changing the generation.
   */
  allow_people?: boolean;
  /** Stats from the most recent gather for this slot — powers the honest empty state. Absent on legacy slots. */
  last_gather?: GatherStats;
}

/**
 * Whether this slot's gather should drop people-showing photos: the
 * generation-wide option unless the operator flipped the per-slot override on.
 * Backward compatible by construction — a legacy slot with no `allow_people`
 * key simply inherits the generation, exactly as before.
 */
export function slotExcludesPeople(
  slot: Pick<ImageSlot, "allow_people">,
  generationExcludesPeople: boolean,
): boolean {
  return slot.allow_people === true ? false : generationExcludesPeople;
}

/** An all-zero gather stat block — the identity for `aggregateGatherStats`. */
export function emptyGatherStats(): GatherStats {
  return {
    fetched: 0,
    alreadySeen: 0,
    rejectedByVision: 0,
    trimmed: 0,
    kept: 0,
    pages: 0,
    queries: [],
    broadened: false,
    timedOut: false,
    attempts: [],
  };
}

/**
 * Pure: fold a click's per-page attempts into one summary. `pages` counts
 * DISTINCT Pexels pages (a broadened retry re-searches the SAME page number
 * with a different query, so it must not double-count the page budget).
 */
export function aggregateGatherStats(attempts: GatherAttempt[], opts: { timedOut?: boolean } = {}): GatherStats {
  const out = emptyGatherStats();
  const pages = new Set<number>();
  for (const a of attempts) {
    out.fetched += a.fetched;
    out.alreadySeen += a.alreadySeen;
    out.rejectedByVision += a.rejectedByVision;
    out.trimmed += a.trimmed;
    out.kept += a.kept;
    pages.add(a.page);
    if (!out.queries.includes(a.query)) out.queries.push(a.query);
    if (a.broadened) out.broadened = true;
  }
  out.pages = pages.size;
  out.attempts = attempts;
  out.timedOut = opts.timedOut === true;
  return out;
}

/**
 * Pure: the sentence the operator reads instead of a bare "No candidates".
 * Empty string when there is nothing to report (no gather has run), so the UI
 * can simply not render a line.
 */
export function describeGatherStats(stats: GatherStats | undefined): string {
  if (!stats || stats.pages === 0) return "";
  const pages = `${stats.pages} page${stats.pages === 1 ? "" : "s"}`;
  if (stats.fetched === 0) {
    return `Searched ${pages} — Pexels had no more photos for this search.`;
  }
  const bits = [`found ${stats.fetched}`];
  if (stats.rejectedByVision > 0) bits.push(`${stats.rejectedByVision} filtered out (people)`);
  if (stats.alreadySeen > 0) bits.push(`${stats.alreadySeen} already shown`);
  if (stats.trimmed > 0) bits.push(`${stats.trimmed} over this slot's limit`);
  bits.push(`${stats.kept} new`);
  const broad = stats.broadened ? " Also tried a broader search." : "";
  const slow = stats.timedOut ? " Stopped early on the time budget — click again to keep looking." : "";
  return `Searched ${pages}: ${bits.join(", ")}.${broad}${slow}`;
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

/**
 * Defensive read of `template_generations.image_slots` — DB JSONB, shape not
 * guaranteed at compile time. Keeps only entries that look like a real
 * ImageSlot (string id/kind, array candidates/selected); a corrupt or
 * partial row degrades to fewer slots rather than throwing. Mirrors the
 * runner's own read of the same column (runnerV2.ts) so both the plan/build
 * pipeline and the curation APIs (Task 5) agree on what counts as valid.
 */
export function parseImageSlots(v: unknown): ImageSlot[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is ImageSlot => {
    if (!s || typeof s !== "object") return false;
    const slot = s as Partial<ImageSlot>;
    return (
      typeof slot.id === "string" &&
      typeof slot.kind === "string" &&
      Array.isArray(slot.candidates) &&
      Array.isArray(slot.selected)
    );
  });
}
