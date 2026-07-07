import { LEAD_STATUSES, type LeadStatus } from "./types";

export const CAT_VIEW_PREFIX = "leads.cat_view.";
export const CAT_SET_PREFIX = "leads.cat_set.";

/** "Not Ready" -> "not_ready" — must match the SQL in migration 0011. */
export function statusSlug(status: string): string {
  return status.toLowerCase().replace(/ /g, "_");
}

export function catViewKey(status: string): string {
  return CAT_VIEW_PREFIX + statusSlug(status);
}

export function catSetKey(status: string): string {
  return CAT_SET_PREFIX + statusSlug(status);
}

/** Lead categories the user may see, in canonical order. */
export function visibleStatuses(perms: Set<string>): LeadStatus[] {
  return LEAD_STATUSES.filter((s) => perms.has(catViewKey(s)));
}

/** Lead categories the user may set a lead to, in canonical order. */
export function settableStatuses(perms: Set<string>): LeadStatus[] {
  return LEAD_STATUSES.filter((s) => perms.has(catSetKey(s)));
}
