import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { AgentReportBoard } from "@/components/reports/AgentReportBoard";

export default async function AgentReportPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const perms = await getUserPermissions(user.id);
  if (!perms.has("reports.agent_periodic")) redirect("/dashboard");

  // Sales roster via the service client (profiles RLS hides other users), and
  // INCLUDING deactivated profiles — historical periods must stay reportable.
  const admin = createAdminClient();
  const { data: salesDept } = await admin.from("departments").select("id").eq("slug", "sales").single();
  const { data: members } = salesDept
    ? await admin
        .from("department_members")
        .select("user_id, profiles!department_members_user_id_fkey(id, display_name, is_active)")
        .eq("department_id", salesDept.id)
    : { data: [] as never[] };
  const salesUsers = (members ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((m: any) => ({
      id: m.profiles?.id as string,
      display_name: (m.profiles?.display_name as string | null) ?? "—",
      is_active: (m.profiles?.is_active as boolean | null) ?? true,
    }))
    .filter((u) => u.id)
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-text mb-1">Agent Periodic Report</h1>
        <p className="text-sm text-text-muted mb-5">
          Pipeline, velocity, ratios, revenue and regions for one agent vs. the team and their previous period.
        </p>
      </div>
      <AgentReportBoard salesUsers={salesUsers} />
    </div>
  );
}
