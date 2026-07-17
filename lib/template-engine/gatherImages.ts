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
import { rankAndTrim, slotDefaults, type ImageCandidate, type ImageSlot } from "./imageSlots";
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
export async function gatherSlotCandidates(args: {
  brief: ImageBrief;
  businessType: string;
  admin: SupabaseClient;
  excludePeople: boolean;
  excludeIds: number[];
  presentMax: number;
  page?: number;
}): Promise<ImageCandidate[]> {
  if (args.presentMax <= 0) return [];

  const excludeSet = new Set(args.excludeIds);
  const photos = await searchPexels(args.brief.query, "landscape", args.admin, fetch, {
    page: args.page ?? 1,
    perPage: WIDE_NET_PER_PAGE,
  });
  const fresh = photos.filter((p) => !excludeSet.has(p.id)).map(pexelsToCandidate);
  if (fresh.length === 0) return [];

  const verdicts = await rankImages(
    fresh.map((c) => ({ url: c.thumb || c.url })),
    { query: args.brief.query, kind: args.brief.kind, businessType: args.businessType },
  );
  const vetted: ImageCandidate[] = fresh.map((c, i) => ({ ...c, vision: verdicts[i] }));
  return rankAndTrim(vetted, { excludePeople: args.excludePeople, presentMax: args.presentMax });
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

    const candidates = clientCandidate ? [clientCandidate, ...gathered] : gathered;
    const seenPexelsIds = gathered
      .map((c) => c.pexelsId)
      .filter((id): id is number => typeof id === "number");

    return {
      id: b.slot_id,
      kind: b.kind,
      label: humanizeSlotId(b.slot_id),
      pick_max,
      present_max,
      candidates,
      selected: clientCandidate ? [clientCandidate.url] : [],
      seen_pexels_ids: seenPexelsIds,
      next_page: 2, // page 1 was just gathered; "show different ones" starts at 2
    };
  });
}
