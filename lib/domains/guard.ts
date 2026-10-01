import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { loadDomainRow, type DomainWithLead } from "./detail";

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

/** A domain route's session + permission + the row itself (404 when unknown). */
export async function requireDomainRow(
  level: "view" | "manage" | "purchase",
  id: string,
): Promise<{ auth: DomainsAuth; row: DomainWithLead } | { response: Response }> {
  const auth = await requireDomains(level);
  if ("error" in auth) return { response: domainsAuthError(auth.error) };
  const row = await loadDomainRow(auth.admin, id);
  if (!row) return { response: Response.json({ error: "Domain not found" }, { status: 404 }) };
  return { auth, row };
}

/** A manage.ts result as the HTTP answer: the payload, or the error (+ the registrar page to finish it on). */
export function manageResponse(r: { ok: true } | { ok: false; status: number; error: string; link?: string }): Response {
  if (r.ok) return Response.json(r);
  return Response.json(r.link ? { error: r.error, link: r.link } : { error: r.error }, { status: r.status });
}
