/**
 * Curated-image fallback for the curation screen.
 *
 * `curated_images` (migration 0034) has existed since Phase 2 but nothing ever
 * read or wrote it — it was created for exactly this case and left unwired.
 * These are HUMAN-APPROVED photos (`approved_by`), so they bypass the vision
 * people-gate entirely: a person already looked at them and said yes.
 *
 * Lookup convention (defined here because nothing else defined it):
 *   - `service_key`  = the image slot's id (the brief's `slot_id`)
 *   - `business_type` = `deriveBusinessType(brief)` — the lead's site_type
 * An exact `service_key` hit is preferred; a `business_type` hit is the wider
 * net. Everything here is best-effort: a missing table, an RLS surprise or any
 * query error yields an empty list rather than failing the operator's click.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImageCandidate, VisionVerdict } from "./imageSlots";

/** Ceiling on curated rows offered per click — this is a fallback, not the main gallery. */
const CURATED_LIMIT = 6;

interface CuratedRow {
  url: unknown;
  thumb: unknown;
  source: unknown;
  vision: unknown;
}

function toCandidate(row: CuratedRow): ImageCandidate | null {
  if (typeof row.url !== "string" || !row.url) return null;
  const thumb = typeof row.thumb === "string" && row.thumb ? row.thumb : row.url;
  const vision =
    row.vision && typeof row.vision === "object" ? (row.vision as VisionVerdict) : undefined;
  return { url: row.url, thumb, source: "curated", vision };
}

/**
 * Pure: merge exact-`service_key` rows ahead of broader `business_type` rows,
 * dropping urls the slot already shows, capped at `limit`.
 */
export function pickCuratedCandidates(
  byServiceKey: ImageCandidate[],
  byBusinessType: ImageCandidate[],
  excludeUrls: string[],
  limit = CURATED_LIMIT,
): ImageCandidate[] {
  const seen = new Set(excludeUrls);
  const out: ImageCandidate[] = [];
  for (const c of [...byServiceKey, ...byBusinessType]) {
    if (out.length >= limit) break;
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    out.push(c);
  }
  return out;
}

/**
 * Human-approved images for a slot, newest-approved first. Never throws; an
 * unavailable table simply means "no curated fallback".
 */
export async function fetchCuratedCandidates(
  admin: SupabaseClient,
  args: { serviceKey: string; businessType: string; excludeUrls: string[]; limit?: number },
): Promise<ImageCandidate[]> {
  const limit = args.limit ?? CURATED_LIMIT;
  const load = async (column: "service_key" | "business_type", value: string): Promise<ImageCandidate[]> => {
    if (!value.trim()) return [];
    try {
      // Two `.eq` queries rather than one `.or(...)`: `business_type` is
      // free-text ("Roofing, Gutters") and PostgREST's `or` filter is a
      // comma-delimited string — interpolating user data into it is a
      // filter-injection waiting to happen.
      const { data, error } = await admin
        .from("curated_images")
        .select("url, thumb, source, vision")
        .eq(column, value.trim())
        .order("times_used", { ascending: true })
        .limit(limit);
      if (error || !Array.isArray(data)) return [];
      return (data as CuratedRow[]).map(toCandidate).filter((c): c is ImageCandidate => c !== null);
    } catch {
      return [];
    }
  };

  const [byServiceKey, byBusinessType] = await Promise.all([
    load("service_key", args.serviceKey),
    load("business_type", args.businessType),
  ]);
  return pickCuratedCandidates(byServiceKey, byBusinessType, args.excludeUrls, limit);
}

/**
 * Bump `times_used` for curated urls the operator actually selected. Read-then-
 * write (no RPC exists) and entirely best-effort: this is usage telemetry, and
 * losing a count must never fail a selection the operator already made.
 */
export async function bumpCuratedUsage(admin: SupabaseClient, urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  try {
    const { data, error } = await admin
      .from("curated_images")
      .select("id, times_used")
      .in("url", urls);
    if (error || !Array.isArray(data)) return;
    await Promise.all(
      (data as { id: string; times_used: number | null }[]).map((row) =>
        admin
          .from("curated_images")
          .update({ times_used: (row.times_used ?? 0) + 1 })
          .eq("id", row.id),
      ),
    );
  } catch {
    // telemetry only
  }
}
