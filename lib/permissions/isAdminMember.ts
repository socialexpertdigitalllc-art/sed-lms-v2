import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * App-side mirror of the SQL `is_admin()` RLS helper (migration 0001): is the
 * user a member of the Admin department (slug "admin")? Used by admin-client
 * write paths to re-apply the ownership rules RLS would have enforced.
 */
export async function isAdminMember(admin: Admin, userId: string): Promise<boolean> {
  const { data: dept } = await admin
    .from("departments")
    .select("id")
    .eq("slug", "admin")
    .single();
  if (!dept) return false;
  const { data: membership } = await admin
    .from("department_members")
    .select("user_id")
    .eq("department_id", dept.id)
    .eq("user_id", userId)
    .maybeSingle();
  return !!membership;
}
