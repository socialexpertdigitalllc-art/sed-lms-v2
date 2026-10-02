import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";

export type WebsiteAuth = {
  userId: string;
  perms: Set<string>;
  admin: ReturnType<typeof createAdminClient>;
  canManage: boolean;
};

/**
 * Session + permission for the Website CMS routes.
 *   view   — website.view (or manage)
 *   manage — website.manage: edit content, coupons, settings, publish
 */
export async function requireWebsite(level: "view" | "manage"): Promise<WebsiteAuth | { error: 401 | 403 }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  const canManage = perms.has("website.manage");
  const canView = canManage || perms.has("website.view");
  const allowed = level === "view" ? canView : canManage;
  if (!allowed) return { error: 403 };
  return { userId: user.id, perms, admin: createAdminClient(), canManage };
}

export function websiteAuthError(status: 401 | 403) {
  return Response.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
}
