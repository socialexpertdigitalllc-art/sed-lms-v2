import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { FollowUpQueue } from "@/components/leads/FollowUpQueue";
import type { Lead } from "@/lib/leads/types";
import { getUserDirectory } from "@/lib/users/directory";
import { getTeamAgentIds } from "@/lib/teams/closers";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetchAll";

export default async function FollowUpsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const perms = await getUserPermissions(user.id);
  if (!perms.has("leads.view")) redirect("/leads");

  const admin = createAdminClient();
  // Independent reads fire together; leads come in pages (PostgREST caps one
  // response at 1,000 rows — the table is past that).
  const [{ data: leadsData }, agents, teamAgentIds] = await Promise.all([
    fetchAllRows<Lead>((from, to) =>
      supabase
        .from("leads")
        .select("*")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
    getUserDirectory(),
    getTeamAgentIds(admin, user.id),
  ]);
  const leads = (leadsData ?? []) as Lead[];

  const agentNameById: Record<string, string> = {};
  for (const a of agents ?? []) agentNameById[a.id] = a.display_name ?? "—";

  return (
    <FollowUpQueue
      leads={leads}
      agentNameById={agentNameById}
      currentUserId={user.id}
      teamAgentIds={teamAgentIds}
    />
  );
}
