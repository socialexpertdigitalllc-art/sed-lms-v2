import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * "Closed by" may only be empty, the acting user ("Self"), or a member of the
 * Closing department. Enforced at every write path — the form's dropdown is
 * presentation, not enforcement.
 */
export async function isAllowedClosedBy(
  admin: Admin,
  actorId: string,
  closedBy: string | null | undefined
): Promise<boolean> {
  if (closedBy === undefined || closedBy === null) return true;
  if (closedBy === actorId) return true;
  const { data: dept } = await admin
    .from("departments")
    .select("id")
    .eq("slug", "closing")
    .maybeSingle();
  if (!dept) return false;
  const { data: member } = await admin
    .from("department_members")
    .select("user_id")
    .eq("department_id", dept.id)
    .eq("user_id", closedBy)
    .maybeSingle();
  return !!member;
}

export const CLOSED_BY_MESSAGE =
  "Closed by must be yourself or a member of the Closing department.";
