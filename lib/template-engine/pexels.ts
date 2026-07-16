import type { SupabaseClient } from "@supabase/supabase-js";

export interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  alt: string | null;
  photographer?: string;
  avg_color?: string | null;
  src: { original: string; large2x: string; large: string; medium: string };
}

export interface ImageSlot {
  key: string;
  query: string;
  altQueries: string[];
  orientation: "landscape" | "square";
  minWidth: number;
  wantsAction?: boolean;
}

const CACHE_TABLE = "pexels_image_cache";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ACTION_RE = /work|repair|install|technician|team|fixing|cleaning/i;
const STOP_WORDS = new Set(["the", "and", "for", "with", "from", "that", "this", "are", "was", "our", "your"]);

export function normQuery(q: string): string {
  return (q ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}

/** Cheap suffix stemmer so "repairing"/"repairs" match "repair", "services" matches "service". */
function stemWord(word: string): string {
  let s = word;
  if (s.endsWith("ies") && s.length > 4) {
    s = s.slice(0, -3) + "y";
  } else {
    for (const suffix of ["ings", "ing", "ers", "er", "es", "s"]) {
      if (s.endsWith(suffix) && s.length - suffix.length >= 3) {
        s = s.slice(0, -suffix.length);
        break;
      }
    }
  }
  if (s.endsWith("e") && s.length > 3) s = s.slice(0, -1);
  return s;
}

function stems(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOP_WORDS.has(raw)) continue;
    out.add(stemWord(raw));
  }
  return out;
}

/**
 * Deterministic photo scoring for a slot.
 * - Pexels rank decay: 15 - index
 * - +3 per slot.query keyword-stem found in the alt text
 * - width below slot.minWidth or an already-used id kills the photo (-Infinity)
 * - aspect outside the slot's window costs 6 (landscape wants w/h >= 1.3; square 0.7-1.4)
 * - +4 when the slot wants action and the alt shows people working
 * - repeating the previous photographer costs 3 (variety)
 */
export function scorePhoto(
  photo: PexelsPhoto,
  slot: ImageSlot,
  index: number,
  usedIds: Set<number>,
  lastPhotographer: string | null
): number {
  if (usedIds.has(photo.id)) return -Infinity;
  if (photo.width < slot.minWidth) return -Infinity;

  let score = 15 - index;

  const ratio = photo.height > 0 ? photo.width / photo.height : 0;
  const aspectOk = slot.orientation === "landscape" ? ratio >= 1.3 : ratio >= 0.7 && ratio <= 1.4;
  if (!aspectOk) score -= 6;

  if (photo.alt) {
    const altStems = stems(photo.alt);
    for (const stem of stems(slot.query)) {
      if (altStems.has(stem)) score += 3;
    }
    if (slot.wantsAction && ACTION_RE.test(photo.alt)) score += 4;
  }

  if (lastPhotographer && photo.photographer && photo.photographer === lastPhotographer) score -= 3;

  return score;
}

/** Highest-scoring photo for the slot; ties resolve to the earlier (better-ranked) photo. */
export function pickBest(
  photos: PexelsPhoto[],
  slot: ImageSlot,
  usedIds: Set<number>,
  lastPhotographer: string | null
): PexelsPhoto | null {
  let best: PexelsPhoto | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < photos.length; i++) {
    const score = scorePhoto(photos[i], slot, i, usedIds, lastPhotographer);
    if (score > bestScore) {
      bestScore = score;
      best = photos[i];
    }
  }
  return bestScore === -Infinity ? null : best;
}

function toPhoto(raw: unknown): PexelsPhoto | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const src = (r.src && typeof r.src === "object" ? r.src : {}) as Record<string, unknown>;
  const id = Number(r.id);
  const width = Number(r.width);
  const height = Number(r.height);
  if (!Number.isFinite(id) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  return {
    id,
    width,
    height,
    alt: typeof r.alt === "string" ? r.alt : null,
    photographer: typeof r.photographer === "string" ? r.photographer : undefined,
    avg_color: typeof r.avg_color === "string" ? r.avg_color : null,
    src: {
      original: String(src.original ?? ""),
      large2x: String(src.large2x ?? ""),
      large: String(src.large ?? ""),
      medium: String(src.medium ?? ""),
    },
  };
}

// Pexels caps per_page at 80; page is 1-based.
const PEXELS_MAX_PER_PAGE = 80;
const DEFAULT_PER_PAGE = 15;

/**
 * Search Pexels with a 30-day cache in `pexels_image_cache`.
 * Cache key: "{orientation}:{normQuery}:{perPage}:{page}" — the page + perPage
 * MUST be in the key, otherwise page 2 replays page 1's cached rows (which
 * silently breaks both the wide net and the operator's "show different ones").
 * `opts` is a trailing 5th arg so every existing 3-arg / 4-arg (fetchImpl)
 * caller keeps its exact behaviour: page defaults to 1, perPage to 15.
 * Returns [] on ANY failure (missing key, network, non-2xx, bad json) — never throws.
 */
export async function searchPexels(
  query: string,
  orientation: "landscape" | "square",
  admin: SupabaseClient,
  fetchImpl: typeof fetch = fetch,
  opts: { page?: number; perPage?: number } = {}
): Promise<PexelsPhoto[]> {
  const qn = normQuery(query);
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const perPage = Math.min(PEXELS_MAX_PER_PAGE, Math.max(1, Math.floor(opts.perPage ?? DEFAULT_PER_PAGE)));
  const cacheKey = `${orientation}:${qn}:${perPage}:${page}`;

  try {
    const { data } = await admin
      .from(CACHE_TABLE)
      .select("results, fetched_at")
      .eq("query_norm", cacheKey)
      .maybeSingle();
    if (
      data &&
      Array.isArray(data.results) &&
      data.fetched_at &&
      Date.now() - new Date(data.fetched_at).getTime() < CACHE_TTL_MS
    ) {
      return data.results as PexelsPhoto[];
    }
  } catch {
    // cache is best-effort
  }

  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return [];

  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(qn)}&per_page=${perPage}&page=${page}&orientation=${orientation}`;
  // Retry a transient 429/5xx a couple of times with backoff so a momentary rate
  // limit (many slots gather at once) doesn't leave a slot empty. A hard quota
  // exhaustion still ends up empty, but the operator's "show different ones"
  // recovers it once the window resets.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetchImpl(url, { headers: { Authorization: apiKey } });
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      if (!res.ok) return [];
      const json = (await res.json()) as { photos?: unknown[] };
      const photos = Array.isArray(json?.photos)
        ? json.photos.map(toPhoto).filter((p): p is PexelsPhoto => p !== null)
        : [];
      // Only cache a NON-EMPTY result — an empty page from a transient outage
      // must never poison the 30-day cache and persist as "no photos".
      if (photos.length > 0) {
        try {
          await admin.from(CACHE_TABLE).upsert({
            query_norm: cacheKey,
            results: photos,
            fetched_at: new Date().toISOString(),
          });
        } catch {
          // cache write is best-effort
        }
      }
      return photos;
    } catch {
      if (attempt >= 3) return [];
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return [];
}

/** Download an image to bytes; null on any failure — never throws. */
export async function downloadImage(url: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array | null> {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}
