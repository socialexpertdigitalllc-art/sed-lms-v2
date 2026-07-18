import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { DeploymentsBoard, type DeployedRow } from "@/components/template-engine/wizard/DeploymentsBoard";

export const dynamic = "force-dynamic";

// Live client sites: every generation currently at status "deployed".
export default async function DeploymentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.deploy") && !perms.has("templates.generate")) redirect("/dashboard");
  const canDeploy = perms.has("templates.deploy");

  // Perm-gated page → admin client, mirroring the launcher's picker pattern.
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("template_generations")
    .select("id, lead_id, deployed_url, updated_at, created_at")
    .eq("status", "deployed")
    .order("updated_at", { ascending: false })
    .limit(200);

  const leadIds = [...new Set((rows ?? []).map((r) => r.lead_id))];
  const { data: leads } = leadIds.length
    ? await admin.from("leads").select("id, business_name, status").in("id", leadIds)
    : { data: [] as { id: string; business_name: string; status: string }[] };
  const leadById = new Map((leads ?? []).map((l) => [l.id, l]));

  const deployed: DeployedRow[] = (rows ?? []).map((r) => ({
    id: r.id,
    lead_id: r.lead_id,
    business_name: leadById.get(r.lead_id)?.business_name ?? "(deleted lead)",
    lead_status: leadById.get(r.lead_id)?.status ?? "",
    deployed_url: r.deployed_url,
    updated_at: r.updated_at,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Deployed websites</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Every live client site. Redeploy pushes the generation&apos;s current build again; take-down removes the site
          and frees the link.
        </p>
      </div>
      <DeploymentsBoard deployed={deployed} canDeploy={canDeploy} />
    </div>
  );
}
