import type { BusinessBrief } from "./prompt";

/**
 * What images a Site Builder run needs, derived purely from the lead's own
 * `BusinessBrief` — no template, no manifest, no slots. This replaces the
 * manual "operator searches for each image themselves" step: every need
 * listed here gets auto-sourced candidates (see `imageSourcing.ts`) before
 * the operator ever sees the image screen.
 */
export interface ImageNeed {
  /** The exact label carried through to the run's `images[].purpose` — see
   *  `SuppliedImage` in prompt.ts. Also what's shown as the row label. */
  purpose: string;
  /** The search query used to source candidates for this need. Shown in the
   *  UI so a bad result is diagnosable ("why did THIS come back") instead of
   *  mysterious. */
  query: string;
}

export interface ImageNeedsResult {
  needs: ImageNeed[];
  /** True when the lead listed more services than get their own image need
   *  (see MAX_SERVICE_IMAGES) — every service still appears in the prompt's
   *  copy, this only caps how many get their own photo need. */
  servicesTruncated: boolean;
  /** The service names dropped from image-sourcing because of the cap, in
   *  the order they were dropped — empty when nothing was truncated. */
  droppedServices: string[];
}

/** A lead offering more services than this simply doesn't get an image need
 *  for every last one of them — the image screen would become unusable, and
 *  most templates don't have that many service slots to begin with. */
const MAX_SERVICE_IMAGES = 8;

/**
 * The client's own trade noun, taken verbatim from what they told us —
 * `site_type` if the lead supplied one, else the FIRST non-empty service
 * phrase as written, lowercased. Deliberately never a guessed/mapped trade
 * taxonomy (e.g. "Drain Cleaning" -> "plumbing"): the client stated their
 * trade in their own words, and image search should search for exactly
 * that. Mirrors `tradeNoun` in the old `lib/site-studio/run/imageSource.ts`.
 */
function tradeNoun(brief: BusinessBrief): string {
  const siteType = brief.site_type?.trim();
  if (siteType) return siteType.toLowerCase();
  const firstService = brief.services.find((s) => s.trim().length > 0);
  return (firstService ?? "").trim().toLowerCase();
}

/** Joins non-empty parts with a space, dropping any part that duplicates one
 *  already included (case-insensitive) — avoids a query like "drain cleaning
 *  drain cleaning" when a service phrase happens to equal the trade noun
 *  (e.g. the lead has no `site_type`, so the trade noun IS their first
 *  service). */
function buildQuery(...parts: string[]): string {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const part of parts) {
    const p = part.trim();
    if (!p) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(p);
  }
  return words.join(" ");
}

/**
 * Derive the full, deterministic set of image needs for a run: one Hero, one
 * per service (capped, see MAX_SERVICE_IMAGES), one About. Pure — same brief
 * always produces the same needs in the same order, no I/O, no randomness.
 */
export function deriveImageNeeds(brief: BusinessBrief): ImageNeedsResult {
  const trade = tradeNoun(brief);
  const needs: ImageNeed[] = [];

  needs.push({ purpose: "Hero", query: buildQuery(trade) });

  const services = brief.services.map((s) => s.trim()).filter(Boolean);
  const servicesTruncated = services.length > MAX_SERVICE_IMAGES;
  const keptServices = services.slice(0, MAX_SERVICE_IMAGES);
  const droppedServices = services.slice(MAX_SERVICE_IMAGES);
  for (const service of keptServices) {
    needs.push({ purpose: `Service: ${service}`, query: buildQuery(service.toLowerCase(), trade) });
  }

  needs.push({ purpose: "About", query: buildQuery("team", trade) });

  return { needs, servicesTruncated, droppedServices };
}
