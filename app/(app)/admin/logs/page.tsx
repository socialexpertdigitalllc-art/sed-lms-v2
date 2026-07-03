import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
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
  const [{ data: audit }, { data: activity }, { data: profiles }] = await Promise.all([
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
  ]);

  const nameById: Record<string, string> = {};
  for (const p of profiles ?? []) nameById[p.id] = p.display_name ?? p.id;

  return <LogsViewer audit={audit ?? []} activity={activity ?? []} nameById={nameById} />;
}
