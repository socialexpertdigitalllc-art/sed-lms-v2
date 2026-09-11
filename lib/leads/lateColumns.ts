/**
 * Columns added by migrations 0073, 0074 and 0077, tolerated as absent.
 *
 * Code reaches production by a git push; migrations are applied by hand. The
 * window between the two is real, and an unapplied migration must not turn
 * every lead submission into a 500 — the write should land without the new
 * fields and start carrying them the moment the column exists. The follow-up
 * route already does exactly this for `is_specific_time` (0068); this is the
 * same contract, shared, because there are now four such columns across three
 * routes.
 */
export const LATE_LEAD_COLUMNS = [
  "owner_name",
  "developer_instructions",
  "social_profiles",
  "follow_up_set_at",
  "recommended_template_id",
  "custom_area",
  "category",
] as const;

/**
 * Does this write error blame one of those columns? PostgREST reports an
 * unknown column as "Could not find the 'x' column of 'leads' in the schema
 * cache" (PGRST204); Postgres itself says `column "x" of relation ... does not
 * exist`. Both name the column, which is all this needs to match.
 */
export function blamesLateColumn(message: string | null | undefined): boolean {
  if (!message) return false;
  return LATE_LEAD_COLUMNS.some((c) => new RegExp(`\\b${c}\\b`).test(message));
}

/**
 * The same row without any late column. Strips ALL of them rather than only
 * the one named: the error reports the first column the server choked on, so
 * retrying one at a time would take a round-trip per column for no gain.
 */
export function withoutLateColumns<T extends Record<string, unknown>>(row: T): Partial<T> {
  const out: Partial<T> = { ...row };
  for (const c of LATE_LEAD_COLUMNS) delete out[c as keyof T];
  return out;
}
