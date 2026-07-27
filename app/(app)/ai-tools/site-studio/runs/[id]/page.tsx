import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { StudioTabs } from "@/components/site-studio/StudioTabs";
import { RunCockpit } from "@/components/site-studio/RunCockpit";

export const dynamic = "force-dynamic";

export default async function SiteStudioRunDetailPage({ params }: { params: Promise<{ id: string }> }) {
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
      <StudioTabs />
      <RunCockpit runId={id} />
    </div>
  );
}
