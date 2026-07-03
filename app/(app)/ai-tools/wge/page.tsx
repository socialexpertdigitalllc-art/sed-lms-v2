import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getWgeConfig } from "@/lib/ai-tools/wge";
import { WgeControl } from "@/components/ai-tools/wge/WgeControl";

export default async function WgePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const perms = await getUserPermissions(user.id);
  const hasAiTools = perms.has("ai_tools.webcraft") || perms.has("ai_tools.deepseek");
  if (!perms.has("wge.manage") || !hasAiTools) redirect("/ai-tools");

  const config = await getWgeConfig();
  const { data: leads } = await supabase
    .from("leads")
    .select("id, business_name")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  return <WgeControl initialConfig={config} leads={leads ?? []} />;
}
