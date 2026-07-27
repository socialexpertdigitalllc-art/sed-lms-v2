import type { BusinessBrief } from "./prompt";

/**
 * What the Site Builder image screen needs to search for, derived purely
 * from the lead's own `BusinessBrief` — no template, no manifest, no slots.
 *
 * Deliberately narrow: this is ONLY the per-service searches. It does not
 * decide anything about Hero (that is a composition over these same
 * searches plus the lead's own photos — see `imageSourcing.ts`) and it does
 * not produce an "About" need at all — that row was never asked for and has
 * been dropped.
 */
export interface ServiceQuery {
  /** The service exactly as the lead listed it, trimmed. Also what's shown
   *  as the row label ("Service: <service>"). */
  service: string;
  /** The search query for this row — the service name ALONE, nothing
   *  appended. In particular this is never influenced by the lead's
   *  `site_type`: that field is a sales/pipeline label ("Custom Website",
   *  "Custom", "Redesign" — verified never a trade) and has no business
   *  shaping an image search. */
  query: string;
}

export interface ImageNeedsResult {
  services: ServiceQuery[];
  /** True when the lead listed more services than get their own row (see
   *  MAX_SERVICE_IMAGES) — every service still appears in the prompt's own
   *  copy, this only caps how many get their own image row. */
  servicesTruncated: boolean;
  /** The service names dropped from image-sourcing because of the cap, in
   *  the order they were dropped — empty when nothing was truncated. */
  droppedServices: string[];
}

/** A lead offering more services than this simply doesn't get an image row
 *  for every last one of them — the image screen would become unusable, and
 *  most templates don't have that many service slots to begin with. Carried
 *  over unchanged from the previous design; unrelated to this rewrite. */
const MAX_SERVICE_IMAGES = 8;

/**
 * Derive the per-service search queries for a run: one row per service the
 * lead listed (capped, see MAX_SERVICE_IMAGES), each searched on the bare
 * service name. Pure — same brief always produces the same result in the
 * same order, no I/O, no randomness.
 *
 * There is no Hero need here and no About need: Hero is composed from these
 * same service searches plus the lead's own photos (see
 * `imageSourcing.ts#sourceImages`), and About was never part of the spec.
 */
export function deriveImageNeeds(brief: BusinessBrief): ImageNeedsResult {
  const services = brief.services.map((s) => s.trim()).filter(Boolean);
  const servicesTruncated = services.length > MAX_SERVICE_IMAGES;
  const kept = services.slice(0, MAX_SERVICE_IMAGES);
  const droppedServices = services.slice(MAX_SERVICE_IMAGES);

  const serviceQueries: ServiceQuery[] = kept.map((service) => ({ service, query: service }));

  return { services: serviceQueries, servicesTruncated, droppedServices };
}
