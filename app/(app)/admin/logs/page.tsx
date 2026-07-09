import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getAppSettings, logoPublicUrl } from "@/lib/settings/appSettings";
import { LogsViewer } from "@/components/admin/LogsViewer";

export default async function LogsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const perms = await getUserPermissions(user.id);
  if (!perms.has("admin.logs.view")) redirect("/dashboard");

  const admin = createAdminClient();
  const [{ data: audit }, { data: activity }, { data: profiles }, { data: sessions }, settings] = await Promise.all([
    admin
      .from("activity_log")
      .select("id, user_id, action, entity_type, entity_id, old_value, new_value, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    admin
      .from("user_activity")
      .select("id, user_id, type, path, label, meta, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
    admin.from("profiles").select("id, display_name"),
    admin
      .from("user_sessions")
      .select("user_id, signed_in_at, signed_out_at, last_seen_at, ip, user_agent")
      .gte("signed_in_at", new Date(Date.now() - 30 * 864e5).toISOString())
      .order("signed_in_at", { ascending: false }),
    getAppSettings(),
  ]);

  const nameById: Record<string, string> = {};
  for (const p of profiles ?? []) nameById[p.id] = p.display_name ?? p.id;

  const canManageSettings = perms.has("admin.settings.manage");

  return (
    <LogsViewer
      audit={audit ?? []}
      activity={activity ?? []}
      nameById={nameById}
      sessions={sessions ?? []}
      settings={settings}
      logoUrl={logoPublicUrl(settings.logo_path)}
      canManageSettings={canManageSettings}
    />
  );
}
