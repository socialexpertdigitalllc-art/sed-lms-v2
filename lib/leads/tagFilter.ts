/**
 * Pure tag helpers shared by TagFilter, LeadsTable, and LeadDetail.
 * Kept free of React/DOM so they're unit-testable and reused everywhere.
 */

/** Add `id` when absent, remove it when present. Returns a new array. */
export function toggleTag(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
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
