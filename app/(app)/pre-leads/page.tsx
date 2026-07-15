import { createClient } from "@/lib/supabase/server";
import type { PreLead } from "@/lib/preleads/types";
import { PreLeadOverview } from "@/components/preleads/PreLeadOverview";
import { WorldClocks } from "@/components/layout/WorldClocks";

export default async function PreLeadsPage() {
  const supabase = await createClient();
  const [{ data }, { data: agents }] = await Promise.all([
    supabase.from("pre_leads").select("*").is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, display_name"),
  ]);
  const preLeads = (data ?? []) as PreLead[];

  const agentNameById: Record<string, string> = {};
  for (const a of agents ?? []) agentNameById[a.id] = a.display_name ?? "—";

  return (
    <div>
      <h1 className="text-xl font-semibold text-text">Pre-Leads</h1>
      <p className="text-sm text-text-muted mt-0.5">Your pipeline of prospective leads</p>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5 mt-5">
        <PreLeadOverview preLeads={preLeads} agentNameById={agentNameById} />
        <WorldClocks />
      </div>
    </div>
  );
}
