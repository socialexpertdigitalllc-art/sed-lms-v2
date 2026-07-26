import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { StudioTabs } from "@/components/site-studio/StudioTabs";
import { RunsBoard } from "@/components/site-studio/RunsBoard";

export const dynamic = "force-dynamic";

export default async function SiteStudioRunsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const perms = await getUserPermissions(user.id);
  if (!perms.has("studio.manage")) redirect("/dashboard");

  return (
    <div className="space-y-4">
      <StudioTabs />
      <Suspense fallback={null}>
        <RunsBoard />
      </Suspense>
    </div>
  );
}
