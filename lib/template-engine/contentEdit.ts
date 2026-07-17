/**
 * Merge an operator's content edits into the existing content model without
 * letting them touch the frozen parts (Phase 3, design §10 step 2).
 *
 * Frozen: `image_briefs` + `pages` (slots were built once in the plan phase —
 * brief edits would desync curation; pages carry regenerator section keys),
 * and each service's `key` (doubles as slot id) + `image_query` (feeds /more).
 * Everything else — identity, hero, service copy, stats, testimonials, faq,
 * about — is the operator's to edit. Throws (zod or Error) on invalid input
 * so the route can 422 with detail.
 */
import { contentModelSchema, type ContentModel } from "./contentModel";

export function applyContentEdit(existing: ContentModel, incoming: unknown): ContentModel {
  const parsed = contentModelSchema.parse(incoming); // throws -> route 422s

  // Frozen service fields: match by index (the editor renders existing
  // services in order and cannot add/remove rows - enforce that here).
  if (parsed.services.length !== existing.services.length) {
    throw new Error("Services cannot be added or removed in the editor");
  }
  const services = parsed.services.map((s, i) => ({
    ...s,
    key: existing.services[i].key,
    image_query: existing.services[i].image_query,
  }));

  return {
    ...parsed,
    services,
    image_briefs: existing.image_briefs,
    pages: existing.pages,
  };
}
