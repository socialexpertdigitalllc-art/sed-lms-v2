import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dashboardVisibility, anyDashboardVisible } from "@/lib/dashboard/visibility";
import type { Lead } from "@/lib/leads/types";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { visibleStatuses } from "@/lib/leads/categories";
import { buildRegionFacets } from "@/lib/geo/regions";
import { DashboardBoard } from "@/components/dashboard/DashboardBoard";
import { getUserDirectory } from "@/lib/users/directory";
import { getTeamAgentIds } from "@/lib/teams/closers";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { DASHBOARD_LEAD_SELECT, type DashboardLead } from "@/lib/dashboard/columns";

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

  // Independent reads fire together; salesUsers resolves in parallel.
  // Leads: only the columns the metrics read (see lib/dashboard/columns.ts),
  // and every page of them — PostgREST caps one response at 1,000 rows.
  const [{ data: leadsData }, agents, { data: followUps }, { data: tickets }, salesUsers] =
    await Promise.all([
      fetchAllRows<DashboardLead>((from, to) =>
        supabase
          .from("leads")
          .select(DASHBOARD_LEAD_SELECT)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
      getUserDirectory(),
      supabase.from("lead_follow_ups").select("fu_status, lead_id"),
      supabase.from("lead_tickets").select("status, due_date, created_at, resolved_at, lead_id"),
      salesUsersPromise,
    ]);
  // The board's helpers are typed on the full Lead; they only touch the
  // columns selected above (the type above is the contract that keeps it so).
  const leads = (leadsData ?? []) as unknown as Lead[];
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

  const facets = buildRegionFacets(leads);
  // Sales agents reporting to this viewer — empty unless they are a closer.
  const teamAgentIds = user ? await getTeamAgentIds(admin, user.id) : [];

  return (
    <DashboardBoard
      leads={leads}
      followUps={followUps ?? []}
      tickets={tickets ?? []}
      agentNameById={agentNameById}
      flags={flags}
      visible={visible}
      facets={facets}
      now={new Date().toISOString()}
      canScopeMonth={perms.has("analytics.view_all_agents")}
      currentUserId={user?.id ?? ""}
      teamAgentIds={teamAgentIds}
      salesUsers={salesUsers}
    />
  );
}
