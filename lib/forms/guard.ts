import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { allowedFormScope, type FormScope } from "@/lib/forms/access";

export type FormsAuth = {
  userId: string;
  perms: Set<string>;
  scope: FormScope;
  admin: ReturnType<typeof createAdminClient>;
};

/**
 * Session + permission + scope for every Forms dashboard route/page.
 * `view` needs forms.view (or forms.manage); `manage` needs forms.manage.
 */
export async function requireForms(level: "view" | "manage"): Promise<FormsAuth | { error: 401 | 403 }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  const canManage = perms.has("forms.manage");
  const canView = canManage || perms.has("forms.view");
  if (level === "manage" ? !canManage : !canView) return { error: 403 };
  const admin = createAdminClient();
  const scope = await allowedFormScope(admin, user.id, perms);
  return { userId: user.id, perms, scope, admin };
}

export function formsAuthError(status: 401 | 403) {
  return Response.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
}
