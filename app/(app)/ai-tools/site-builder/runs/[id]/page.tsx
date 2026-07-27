import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { BuilderTabs } from "@/components/site-builder/BuilderTabs";
import { BuilderRun } from "@/components/site-builder/BuilderRun";

export const dynamic = "force-dynamic";

export default async function SiteBuilderRunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const perms = await getUserPermissions(user.id);
  if (!perms.has("studio.manage")) redirect("/dashboard");

  const { id } = await params;

  return (
    <div className="space-y-4">
      <BuilderTabs />
      <BuilderRun runId={id} />
    </div>
  );
}
