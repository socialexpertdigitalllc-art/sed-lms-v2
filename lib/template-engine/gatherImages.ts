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

// A WIDE net per page so the vision pass has plenty to rank and drop from.
// Pexels caps per_page at 80; 24 gives a healthy pool while keeping each
// vision call (chunked at <=12) to at most two requests.
const WIDE_NET_PER_PAGE = 24;

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

/** Prefer the lead's own site_type ("Roofing"); fall back to its services list, then a generic label. */
function deriveBusinessType(brief: GenerationBrief): string {
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

  // Claim client-photo seats up front, in brief order — before any concurrent
  // gather starts — so two slots can never race for the same photo.
  const clientPhotos = [...args.brief.client_photos];
  const clientCandidateFor = new Map<string, ImageCandidate>();
  for (const b of briefs) {
    if (CLIENT_PHOTO_KINDS.has(b.kind) && clientPhotos.length > 0) {
      const url = clientPhotos.shift()!;
      clientCandidateFor.set(b.slot_id, { url, thumb: url, source: "client" });
    }
  }

  return mapWithConcurrency(briefs, SLOT_GATHER_CONCURRENCY, async (b): Promise<ImageSlot> => {
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
