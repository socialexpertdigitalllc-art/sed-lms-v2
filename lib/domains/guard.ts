import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";

export type DomainsAuth = {
  userId: string;
  perms: Set<string>;
  admin: ReturnType<typeof createAdminClient>;
  canManage: boolean;
  canPurchase: boolean;
};

/**
 * Session + permission for the domain routes.
 *   view     — domains.view (or manage / purchase)
 *   manage   — domains.manage: import, link to leads, retry, auto-renew
 *   purchase — domains.purchase: spend money (Admin by default; anyone else
 *              only through a per-user permission override)
 */
export async function requireDomains(level: "view" | "manage" | "purchase"): Promise<DomainsAuth | { error: 401 | 403 }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  const canManage = perms.has("domains.manage");
  const canPurchase = perms.has("domains.purchase");
  const canView = canManage || canPurchase || perms.has("domains.view");
  const allowed = level === "view" ? canView : level === "manage" ? canManage : canPurchase;
  if (!allowed) return { error: 403 };
  return { userId: user.id, perms, admin: createAdminClient(), canManage, canPurchase };
}

export function domainsAuthError(status: 401 | 403) {
  return Response.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
}
