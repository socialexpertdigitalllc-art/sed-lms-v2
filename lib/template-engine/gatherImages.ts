/**
 * Pexels wide-net + vision candidate gathering, per image slot (Phase 2, spec §7).
 *
 * Orchestrates the I/O the operator's curation screen needs: search Pexels for
 * a slot's query, drop anything already seen, vision-rank what's left with
 * Gemini Flash (vision.ts), and keep the vetted top N (imageSlots.ts). Also
 * builds the very first `image_slots[]` for a generation, seeding hero/about
 * with a real client photo when the lead provided one.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { searchPexels, type PexelsPhoto } from "./pexels";
import {
  aggregateGatherStats,
  rankAndTrim,
  slotDefaults,
  type GatherAttempt,
  type GatherStats,
  type ImageCandidate,
  type ImageSlot,
} from "./imageSlots";
import { rankImages } from "./vision";
import type { ImageBrief } from "./contentModel";
import type { GenerationBrief } from "./brief";

// Slots that prefer the business's own real photo over stock — same kinds
// runnerV2's Phase-1-interim resolveImages() treats specially.
const CLIENT_PHOTO_KINDS = new Set(["hero", "about"]);

// Per-slot Pexels+vision gathers run concurrently, capped like the
// regeneration loop (runnerV2's REGEN_CONCURRENCY) so a many-slot plan
// doesn't hammer the Pexels/Gemini APIs at once.
const SLOT_GATHER_CONCURRENCY = 3;

// Candidates fetched per slot. 12 = exactly ONE vision call per slot (the
// vision chunk cap), not two — the single biggest lever for making the image
// step lighter. present_max is 5-6, so 12 is still a comfortable pool to rank
// and trim from; "show different ones" fetches a fresh page on demand.
const WIDE_NET_PER_PAGE = 12;

// A generation only ever shows a handful of images (hero + featured service
// cards + gallery), so cap the service slots the operator has to curate. The
// planner is told to emit ~6 briefs; capping at 6 (was 8) keeps the image step
// light — fewer slots = fewer Pexels+vision round-trips — and a runaway plan
// can never spawn dozens of gathers (which rate-limited and left slots empty).
const MAX_SERVICE_SLOTS = 6;

/**
 * Pure: keep every non-service brief (hero/about/gallery) plus the first
 * `maxService` service briefs, in order. Guarantees a bounded, curatable set of
 * image slots no matter how many services the plan produced.
 */
export function capImageBriefs(briefs: ImageBrief[], maxService = MAX_SERVICE_SLOTS): ImageBrief[] {
  const out: ImageBrief[] = [];
  let serviceCount = 0;
  for (const b of briefs) {
    if (b.kind === "service") {
      if (serviceCount >= maxService) continue;
      serviceCount++;
    }
    out.push(b);
  }
  return out;
}

/** Pure: map one Pexels photo to a candidate. No vision verdict yet — that's rankImages' job. */
export function pexelsToCandidate(photo: PexelsPhoto): ImageCandidate {
  return {
    url: photo.src.large2x || photo.src.original || photo.src.large || photo.src.medium,
    thumb: photo.src.medium || photo.src.large || photo.src.large2x || photo.src.original,
    source: "pexels",
    photographer: photo.photographer,
    width: photo.width,
    height: photo.height,
    pexelsId: photo.id,
  };
}

/**
 * Gather + vet candidates for one slot: search Pexels (a WIDE `page` of the
 * net), drop already-seen ids, vision-rank what's left, and keep the vetted
 * top `presentMax`.
 *
 * `page` is a first-class arg so Task 5's "show different ones" (/more) can
 * fetch page 2, 3, ... and get genuinely fresh photos — the page is now part
 * of searchPexels's cache key (see pexels.ts), so a later page never replays
 * an earlier one. `excludeIds` is kept as belt-and-suspenders: paging should
 * already return new photos, but filtering seen ids guarantees no repeat even
 * if Pexels overlaps pages.
 */
export interface GatherResult {
  candidates: ImageCandidate[];
  /** EVERY Pexels id this attempt looked at — kept, rejected, or trimmed. Recorded as "seen" so a later page never pays the vision cost for a photo this slot already judged. */
  fetchedIds: number[];
  attempt: GatherAttempt;
}

export async function gatherSlotCandidates(args: {
  brief: ImageBrief;
  businessType: string;
  admin: SupabaseClient;
  excludePeople: boolean;
  excludeIds: number[];
  presentMax: number;
  page?: number;
  /** Search text override — the broad businessType fallback (see gatherMoreCandidates). Defaults to the brief's own query. */
  queryOverride?: string;
  broadened?: boolean;
}): Promise<GatherResult> {
  const page = args.page ?? 1;
  const query = args.queryOverride?.trim() || args.brief.query;
  const broadened = args.broadened === true;
  const empty = (over: Partial<GatherAttempt> = {}): GatherResult => ({
    candidates: [],
    fetchedIds: [],
    attempt: {
      query, broadened, page,
      fetched: 0, alreadySeen: 0, rejectedByVision: 0, trimmed: 0, kept: 0,
      ...over,
    },
  });
  if (args.presentMax <= 0) return empty();

  const excludeSet = new Set(args.excludeIds);
  const photos = await searchPexels(query, "landscape", args.admin, fetch, {
    page,
    perPage: WIDE_NET_PER_PAGE,
  });
  const fetchedIds = photos.map((p) => p.id);
  const fresh = photos
    .filter((p) => !excludeSet.has(p.id))
    .map((p) => ({ ...pexelsToCandidate(p), query }));
  const alreadySeen = photos.length - fresh.length;
  if (fresh.length === 0) {
    return { ...empty({ fetched: photos.length, alreadySeen }), fetchedIds };
  }

  const verdicts = await rankImages(
    fresh.map((c) => ({ url: c.thumb || c.url })),
    { query, kind: args.brief.kind, businessType: args.businessType },
  );
  const vetted: ImageCandidate[] = fresh.map((c, i) => ({ ...c, vision: verdicts[i] }));
  const rejectedByVision = args.excludePeople
    ? vetted.filter((c) => c.vision?.people === true).length
    : 0;
  const candidates = rankAndTrim(vetted, { excludePeople: args.excludePeople, presentMax: args.presentMax });

  return {
    candidates,
    fetchedIds,
    attempt: {
      query,
      broadened,
      page,
      fetched: photos.length,
      alreadySeen,
      rejectedByVision,
      trimmed: Math.max(0, fresh.length - rejectedByVision - candidates.length),
      kept: candidates.length,
    },
  };
}

// --- "Show different ones": one click, several pages -------------------------
//
// The old behaviour was one click = one Pexels page. With exclude_people on,
// the vision gate rejects well over half of a trade's stock photos, so a single
// 12-photo page routinely yielded ZERO new candidates and the operator saw "No
// candidates" for a slot where images HAD been found. One click now keeps
// paging until it has something worth showing.

/** Stop paging once a click has produced this many genuinely new candidates — enough to be worth a look without burning pages/quota chasing a full grid. */
export const MIN_NEW_CANDIDATES = 4;

/** Hard ceiling on Pexels pages (and therefore vision calls) per click. 3 pages = up to 36 photos and 3 Gemini calls: enough to beat a ~60% rejection rate, bounded enough to keep cost and latency sane. */
export const MAX_PAGES_PER_CLICK = 3;

/** Wall-clock budget per click. A vision call is ~20s worst case, so this is checked BEFORE starting another page: the request finishes with whatever it has rather than hanging past the operator's patience (and any platform request timeout). */
export const GATHER_TIME_BUDGET_MS = 25_000;

export interface PagingLimits {
  minNew: number;
  maxPages: number;
  timeBudgetMs: number;
}

export const DEFAULT_PAGING_LIMITS: PagingLimits = {
  minNew: MIN_NEW_CANDIDATES,
  maxPages: MAX_PAGES_PER_CLICK,
  timeBudgetMs: GATHER_TIME_BUDGET_MS,
};

/**
 * Pure stop condition for the page loop — the single decision worth unit
 * testing. Keep going only while ALL of these hold: we still want candidates,
 * the page budget has room, and the time budget has room.
 */
export function shouldContinuePaging(
  state: { kept: number; pagesConsumed: number; elapsedMs: number },
  limits: PagingLimits = DEFAULT_PAGING_LIMITS,
): boolean {
  if (state.kept >= limits.minNew) return false;
  if (state.pagesConsumed >= limits.maxPages) return false;
  if (state.elapsedMs >= limits.timeBudgetMs) return false;
  return true;
}

/**
 * One "show different ones" click: page forward from `startPage` until the
 * slot has `minNew` fresh candidates or the page/time budget runs out.
 *
 * When a page yields nothing new for the brief's SPECIFIC query, the same page
 * is retried with the BROAD query (the generation's businessType — no invented
 * text, no extra AI call). A niche brief ("bespoke soffit repair") can be
 * effectively empty on Pexels while the trade term is not.
 */
export async function gatherMoreCandidates(args: {
  brief: ImageBrief;
  businessType: string;
  admin: SupabaseClient;
  excludePeople: boolean;
  excludeIds: number[];
  presentMax: number;
  startPage: number;
  limits?: PagingLimits;
  now?: () => number;
}): Promise<{ candidates: ImageCandidate[]; fetchedIds: number[]; stats: GatherStats; nextPage: number }> {
  const limits = args.limits ?? DEFAULT_PAGING_LIMITS;
  const now = args.now ?? Date.now;
  const started = now();
  const broadQuery = args.businessType.trim();
  const canBroaden = broadQuery.length > 0 && broadQuery.toLowerCase() !== args.brief.query.trim().toLowerCase();

  const seen = new Set(args.excludeIds);
  const kept: ImageCandidate[] = [];
  const attempts: GatherAttempt[] = [];
  let page = Math.max(1, Math.floor(args.startPage));
  let pagesConsumed = 0;
  let timedOut = false;

  const runAttempt = async (queryOverride: string | undefined, broadened: boolean) => {
    const res = await gatherSlotCandidates({
      brief: args.brief,
      businessType: args.businessType,
      admin: args.admin,
      excludePeople: args.excludePeople,
      excludeIds: [...seen],
      // Never ask for 0 (that short-circuits the gather); ask for what's left.
      presentMax: Math.max(1, args.presentMax - kept.length),
      page,
      queryOverride,
      broadened,
    });
    for (const id of res.fetchedIds) seen.add(id);
    kept.push(...res.candidates);
    attempts.push(res.attempt);
    return res;
  };

  while (shouldContinuePaging({ kept: kept.length, pagesConsumed, elapsedMs: now() - started }, limits)) {
    const specific = await runAttempt(undefined, false);
    if (specific.candidates.length === 0 && canBroaden) {
      await runAttempt(broadQuery, true);
    }
    pagesConsumed++;
    page++;
    if (kept.length < limits.minNew && pagesConsumed < limits.maxPages && now() - started >= limits.timeBudgetMs) {
      timedOut = true;
    }
  }

  return {
    candidates: kept,
    fetchedIds: [...seen].filter((id) => !args.excludeIds.includes(id)),
    stats: aggregateGatherStats(attempts, { timedOut }),
    nextPage: page,
  };
}

/** "kitchen-remodel" -> "Kitchen Remodel", "hero-1" -> "Hero 1" — a readable label with no extra data needed. */
function humanizeSlotId(slotId: string): string {
  const words = slotId
    .replace(/[-_]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.length ? words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") : slotId;
}

/** Prefer the lead's own site_type ("Roofing"); fall back to its services list, then a generic label. Exported so the /more curation route (Task 5) can derive the same businessType a fresh gather needs, without re-deriving the rule. */
export function deriveBusinessType(brief: GenerationBrief): string {
  if (brief.site_type && brief.site_type.trim()) return brief.site_type.trim();
  if (brief.services.length) return brief.services.join(", ");
  return "home service business";
}

/** Run `worker` over `items` at most `limit` at a time, preserving result order (unlike a queue-drain, order matters here — these become `image_slots` in brief order). */
async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function drain(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, drain));
  return results;
}

/**
 * Build the initial `image_slots[]` for a generation: one slot per image
 * brief. Hero/about slots claim the lead's real photos first (source
 * "client", pre-selected — pick_max is always >=1 so one seed never
 * overflows it); every slot then gathers Pexels+vision candidates to fill
 * out the rest of its presentable gallery (the remaining seats after any
 * client-photo seed). Per-slot gathers run at bounded concurrency.
 */
export async function buildInitialSlots(
  briefs: ImageBrief[],
  args: { brief: GenerationBrief; admin: SupabaseClient; excludePeople: boolean },
): Promise<ImageSlot[]> {
  const businessType = deriveBusinessType(args.brief);
  // Bound the slot count before doing any I/O — a plan that emitted one brief per
  // service must not spawn dozens of Pexels+vision gathers (which rate-limit).
  const cappedBriefs = capImageBriefs(briefs);

  // Claim client-photo seats up front, in brief order — before any concurrent
  // gather starts — so two slots can never race for the same photo.
  const clientPhotos = [...args.brief.client_photos];
  const clientCandidateFor = new Map<string, ImageCandidate>();
  for (const b of cappedBriefs) {
    if (CLIENT_PHOTO_KINDS.has(b.kind) && clientPhotos.length > 0) {
      const url = clientPhotos.shift()!;
      clientCandidateFor.set(b.slot_id, { url, thumb: url, source: "client" });
    }
  }

  return mapWithConcurrency(cappedBriefs, SLOT_GATHER_CONCURRENCY, async (b): Promise<ImageSlot> => {
    const { pick_max, present_max } = slotDefaults(b.kind);
    const clientCandidate = clientCandidateFor.get(b.slot_id);
    const reservedSeats = clientCandidate ? 1 : 0;

    const gathered = await gatherSlotCandidates({
      brief: b,
      businessType,
      admin: args.admin,
      excludePeople: args.excludePeople,
      excludeIds: [],
      presentMax: Math.max(0, present_max - reservedSeats),
      page: 1,
    });

    const candidates = clientCandidate ? [clientCandidate, ...gathered.candidates] : gathered.candidates;

    return {
      id: b.slot_id,
      kind: b.kind,
      label: humanizeSlotId(b.slot_id),
      pick_max,
      present_max,
      candidates,
      selected: clientCandidate ? [clientCandidate.url] : [],
      // Every id this page LOOKED at, not just the kept ones — a rejected photo
      // must not be re-fetched and re-vision-ranked by "show different ones".
      seen_pexels_ids: gathered.fetchedIds,
      next_page: 2, // page 1 was just gathered; "show different ones" starts at 2
      last_gather: aggregateGatherStats([gathered.attempt]),
    };
  });
}
