import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dashboardVisibility, anyDashboardVisible } from "@/lib/dashboard/visibility";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { visibleStatuses } from "@/lib/leads/categories";
import { LiveDashboardBoard } from "@/components/dashboard/LiveDashboardBoard";
import { getUserDirectory } from "@/lib/users/directory";
import { getTeamAgentIds } from "@/lib/teams/closers";

export default async function DashboardPage() {
  const supabase = await createClient();
  const admin = createAdminClient();

  // Sales-department members — targets for the admin per-agent analytics filter.
  // Loaded via the admin client so the roster is complete for admins (the only
  // ones who see the control; it is gated on `analytics.view_all_agents`). Runs
  // concurrently with the independent reads below; the salesDept→members hop
  // stays a chain inside this promise.
  const salesUsersPromise = (async (): Promise<{ id: string; display_name: string }[]> => {
    const { data: salesDept } = await admin
      .from("departments")
      .select("id")
      .eq("slug", "sales")
      .single();
    if (!salesDept) return [];
    const { data: members } = await admin
      .from("department_members")
      .select("user_id, profiles!department_members_user_id_fkey(id, display_name)")
      .eq("department_id", salesDept.id);
    type MemberRow = { profiles: { id: string; display_name: string | null } | null };
    return ((members ?? []) as unknown as MemberRow[])
      .map((m) => ({ id: m.profiles?.id ?? "", display_name: m.profiles?.display_name ?? "—" }))
      .filter((u) => u.id)
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
  })();

  // Independent reads fire together; salesUsers resolves in parallel. The
  // leads and the follow-ups come from the live stores in the browser
  // (hooks/useLiveLeads.ts) — read once, then only what changes — so neither
  // is read here. Tickets are a small table: sent here, and re-read in the
  // browser when one changes (hooks/useTickRefetch.ts).
  const [agents, { data: tickets }, salesUsers] = await Promise.all([
    getUserDirectory(),
    supabase.from("lead_tickets").select("status, due_date, created_at, resolved_at, lead_id"),
    salesUsersPromise,
  ]);
  const agentNameById: Record<string, string> = {};
  for (const a of agents ?? []) agentNameById[a.id] = a.display_name ?? "—";

  const { data: { user } } = await supabase.auth.getUser();
  const perms = user ? await getUserPermissions(user.id) : new Set<string>();
  const visible: string[] = visibleStatuses(perms);
  const flags = dashboardVisibility(perms);

  if (!anyDashboardVisible(flags)) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-text">Dashboard</h1>
        </div>
        <div className="bg-surface border border-border rounded-lg p-10 text-center text-sm text-text-muted">
          No dashboard widgets are enabled for you. Ask an admin to grant dashboard permissions.
        </div>
      </div>
    );
  }

  // Sales agents reporting to this viewer — empty unless they are a closer.
  const teamAgentIds = user ? await getTeamAgentIds(admin, user.id) : [];

  return (
    <LiveDashboardBoard
      tickets={tickets ?? []}
      agentNameById={agentNameById}
      flags={flags}
      visible={visible}
      now={new Date().toISOString()}
      canScopeMonth={perms.has("analytics.view_all_agents")}
      currentUserId={user?.id ?? ""}
      teamAgentIds={teamAgentIds}
      salesUsers={salesUsers}
    />
  );
}
