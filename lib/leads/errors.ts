/**
 * The `enforce_ready_website_link` DB trigger (migration 0020) rejects any
 * insert/update that sets `leads.status = 'Ready'` with an empty
 * `website_link`. It raises a Postgres exception with `errcode = check_violation`,
 * which PostgREST/Supabase surfaces as `code: "P0001"` (custom `raise exception`)
 * with the message text we set in the trigger. Match on both so we're not
 * relying on the exact error code across environments.
 */
export function isReadyGuardError(
  error: { code?: string | null; message?: string | null } | null | undefined
): boolean {
  if (!error) return false;
  return error.code === "P0001" || /website link is required/i.test(error.message ?? "");
}

export const READY_GUARD_MESSAGE =
  "A website link is required before a lead can be set to Ready.";
