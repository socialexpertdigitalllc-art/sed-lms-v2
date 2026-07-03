import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { Generator } from "@/components/ai-tools/Generator";
import { TOOLS } from "@/lib/ai-tools/config";
import { mapLeadToInput } from "@/lib/ai-tools/leadPrefill";
import { getWgeConfig } from "@/lib/ai-tools/wge";
import type { GenInput } from "@/lib/ai-tools/prompt";

export default async function DeepSeekPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string }>;
}) {
  const { lead } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const perms = await getUserPermissions(user.id);
  if (!perms.has(TOOLS.deepseek.perm)) redirect("/dashboard");

  const config = await getWgeConfig();

  let prefill: Partial<GenInput> | undefined;
  let leadId: string | undefined;
  if (lead) {
    const { data } = await supabase.from("leads").select("*").eq("id", lead).is("deleted_at", null).single();
    if (data) {
      leadId = lead;
      prefill = mapLeadToInput(data, config.variables);
    }
  }

  return <Generator tool="deepseek" prefill={prefill} leadId={leadId} config={config} />;
}
