import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { BuilderTabs } from "@/components/site-builder/BuilderTabs";
import { DeploymentsBoard } from "@/components/site-studio/DeploymentsBoard";

export const dynamic = "force-dynamic";

/** The one deployments board (shared `studio_deployments` table — every
 *  deployed site regardless of which system deployed it), reachable from
 *  Site Builder's own tab bar. */
export default async function SiteBuilderDeploymentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const perms = await getUserPermissions(user.id);
  if (!perms.has("studio.manage")) redirect("/dashboard");

  return (
    <div className="space-y-4">
      <BuilderTabs />
      <DeploymentsBoard />
    </div>
  );
}
