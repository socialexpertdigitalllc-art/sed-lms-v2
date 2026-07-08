import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { listAddons } from "@/lib/settings/addons";
import { AddonsManager } from "@/components/admin/AddonsManager";

export default async function AddOnsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const perms = await getUserPermissions(user.id);
  if (!perms.has("admin.settings.manage")) redirect("/dashboard");

  const addons = await listAddons(false);

  return <AddonsManager initial={addons} />;
}
