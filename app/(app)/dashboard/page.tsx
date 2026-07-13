import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dashboardVisibility, anyDashboardVisible } from "@/lib/dashboard/visibility";
import type { Lead } from "@/lib/leads/types";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { visibleStatuses } from "@/lib/leads/categories";
import { buildRegionFacets } from "@/lib/geo/regions";
import { DashboardBoard } from "@/components/dashboard/DashboardBoard";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: leadsData } = await supabase
    .from("leads")
    .select("*")
    .is("deleted_at", null);
  const leads = (leadsData ?? []) as Lead[];

  const { data: agents } = await supabase.from("profiles").select("id, display_name");
  const agentNameById: Record<string, string> = {};
  for (const a of agents ?? []) agentNameById[a.id] = a.display_name ?? "—";

  const { data: followUps } = await supabase.from("lead_follow_ups").select("fu_status, lead_id");
  const { data: tickets } = await supabase
    .from("lead_tickets")
    .select("status, due_date, created_at, resolved_at, lead_id");

  // Sales-department members — targets for the admin per-agent analytics filter.
  // Loaded via the admin client so the roster is complete for admins (the only
  // ones who see the control; it is gated on `analytics.view_all_agents`).
  const admin = createAdminClient();
  const { data: salesDept } = await admin
    .from("departments")
    .select("id")
    .eq("slug", "sales")
    .single();
  let salesUsers: { id: string; display_name: string }[] = [];
  if (salesDept) {
    const { data: members } = await admin
      .from("department_members")
      .select("user_id, profiles!department_members_user_id_fkey(id, display_name)")
      .eq("department_id", salesDept.id);
    salesUsers = (members ?? [])
      .map((m: any) => ({ id: m.profiles?.id, display_name: m.profiles?.display_name ?? "—" }))
      .filter((u: { id?: string }) => u.id)
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
  }

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
      salesUsers={salesUsers}
    />
  );
}
