import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { LiveFollowUpQueue } from "@/components/leads/LiveLeads";
import { getUserDirectory } from "@/lib/users/directory";
import { getTeamAgentIds } from "@/lib/teams/closers";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function FollowUpsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const perms = await getUserPermissions(user.id);
  if (!perms.has("leads.view")) redirect("/leads");

  const admin = createAdminClient();
  // The leads come from the live leads store in the browser
  // (hooks/useLiveLeads.ts) — read once, then only what changes.
  const [agents, teamAgentIds] = await Promise.all([getUserDirectory(), getTeamAgentIds(admin, user.id)]);

  const agentNameById: Record<string, string> = {};
  for (const a of agents ?? []) agentNameById[a.id] = a.display_name ?? "—";

  return (
    <LiveFollowUpQueue
      agentNameById={agentNameById}
      currentUserId={user.id}
      teamAgentIds={teamAgentIds}
    />
  );
}
