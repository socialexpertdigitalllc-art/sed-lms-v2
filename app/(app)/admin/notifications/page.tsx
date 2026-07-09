import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getAllRules } from "@/lib/notifications/rules";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/events";
import { NotificationRules } from "@/components/admin/NotificationRules";

const DEPT_SLUGS = ["sales", "management", "tech", "support", "admin"] as const;

export default async function AdminNotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const perms = await getUserPermissions(user.id);
  if (!perms.has("admin.notifications.manage")) redirect("/dashboard");

  const admin = createAdminClient();
  const [rules, { data: users }] = await Promise.all([
    getAllRules(),
    admin.from("profiles").select("id, display_name").eq("is_active", true).order("display_name"),
  ]);

  return (
    <NotificationRules
      rules={rules}
      events={NOTIFICATION_EVENTS.map((e) => ({
        key: e.key,
        label: e.label,
        description: e.description,
        bell: e.bell,
        availableRoles: e.availableRoles,
        timingMode: e.timingMode,
      }))}
      users={users ?? []}
      departments={DEPT_SLUGS}
    />
  );
}
