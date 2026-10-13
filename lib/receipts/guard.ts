import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";

/** Signed-in user holding `permission`, else the 401/403 response to return. */
export async function requirePermission(
  permission: string
): Promise<{ userId: string; perms: Set<string> } | { response: NextResponse }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const perms = await getUserPermissions(user.id);
  if (!perms.has(permission)) return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { userId: user.id, perms };
}
