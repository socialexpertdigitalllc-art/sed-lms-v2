import { createClient } from "@/lib/supabase/server";
import { LeadsTable } from "@/components/leads/LeadsTable";
import type { Lead } from "@/lib/leads/types";

export default async function LeadsPage() {
  const supabase = await createClient();
  const { data: leadsData } = await supabase
    .from("leads")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const leads = (leadsData ?? []) as Lead[];

  const { data: agents } = await supabase.from("profiles").select("id, display_name");
  const agentNameById: Record<string, string> = {};
  for (const a of agents ?? []) agentNameById[a.id] = a.display_name ?? "—";

  return <LeadsTable leads={leads} agentNameById={agentNameById} />;
}
