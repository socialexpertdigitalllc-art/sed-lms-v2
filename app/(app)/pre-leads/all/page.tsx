import { createClient } from "@/lib/supabase/server";
import { PreLeadsTable } from "@/components/preleads/PreLeadsTable";
import type { PreLead } from "@/lib/preleads/types";
import { getUserDirectory } from "@/lib/users/directory";

export default async function AllPreLeadsPage() {
  const supabase = await createClient();
  const { data: preLeadsData } = await supabase
    .from("pre_leads")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const preLeads = (preLeadsData ?? []) as PreLead[];

  const agents = await getUserDirectory();
  const agentNameById: Record<string, string> = {};
  for (const a of agents ?? []) agentNameById[a.id] = a.display_name ?? "—";

  return <PreLeadsTable preLeads={preLeads} agentNameById={agentNameById} />;
}
