import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getImportConfig } from "@/lib/import/config";
import { SheetImporter } from "@/components/admin/SheetImporter";

export default async function ImportPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const perms = await getUserPermissions(user.id);
  if (!perms.has("admin.import")) redirect("/dashboard");

  const config = await getImportConfig();
  return <SheetImporter initialConfig={config} />;
}
