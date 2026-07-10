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

  // Sales-department members — the only valid targets for bulk assignment.
  const { data: salesDept } = await supabase
    .from("departments")
    .select("id")
    .eq("slug", "sales")
    .single();
  let salesAgents: { id: string; name: string }[] = [];
  if (salesDept) {
    const { data: members } = await supabase
      .from("department_members")
      .select("user_id, profiles!department_members_user_id_fkey(id, display_name)")
      .eq("department_id", salesDept.id);
    salesAgents = (members ?? [])
      .map((m: any) => ({ id: m.profiles?.id, name: m.profiles?.display_name ?? "—" }))
      .filter((u: any) => u.id);
  }

  return <LeadsTable leads={leads} agentNameById={agentNameById} salesAgents={salesAgents} />;
}
