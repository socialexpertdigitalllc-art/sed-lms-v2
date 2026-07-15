/**
 * Pure tag helpers shared by TagFilter, LeadsTable, and LeadDetail.
 * Kept free of React/DOM so they're unit-testable and reused everywhere.
 */

/** Add `id` when absent, remove it when present. Returns a new array. */
export function toggleTag(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/**
 * Tags are user-scoped: a user may only apply/remove/delete a tag they own.
 * Everyone can *see* tags shared with them (or all tags with `view_all`), but
 * those visible-only tags are read-only. `canApplyTag`/`ownTags` gate the
 * editable surfaces (LeadDetail chips, the add-tag dropdown, BulkTag, and the
 * per-tag delete in TagFilter).
 */
export function canApplyTag(tag: { owner_id: string }, userId: string): boolean {
  return tag.owner_id === userId;
}

/** The subset of `tags` owned by `userId` (a new array; never mutates input). */
export function ownTags<T extends { owner_id: string }>(tags: T[], userId: string): T[] {
  return tags.filter((t) => canApplyTag(t, userId));
}

/**
 * Cartesian product of leads × tags → `lead_tag_links` rows for a bulk insert.
 * Both id lists are deduped first so a repeated id can never trip the
 * `unique(lead_id, tag_id)` constraint. Returns `[]` when either list is empty.
 * Used by the bulk-tag route (`app/api/leads/bulk/route.ts`).
 */
export function buildTagLinkRows(
  leadIds: string[],
  tagIds: string[],
  userId: string
): { lead_id: string; tag_id: string; added_by: string }[] {
  const leads = Array.from(new Set(leadIds));
  const tags = Array.from(new Set(tagIds));
  const rows: { lead_id: string; tag_id: string; added_by: string }[] = [];
  for (const lead_id of leads) {
    for (const tag_id of tags) {
      rows.push({ lead_id, tag_id, added_by: userId });
    }
  }
  return rows;
}

/**
 * Does a lead match the selected tag filter?
 * Empty selection matches every lead; otherwise any-overlap (OR) semantics —
 * a lead matches if it carries at least one of the selected tags.
 */
export function leadMatchesTags(
  leadTagIds: string[] | null | undefined,
  selected: string[]
): boolean {
  if (!selected.length) return true;
  const ids = leadTagIds ?? [];
  return ids.some((t) => selected.includes(t));
}
