import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { SiteStudioBoard } from "@/components/site-studio/SiteStudioBoard";
import { StudioTabs } from "@/components/site-studio/StudioTabs";

export const dynamic = "force-dynamic";

export default async function SiteStudioPage() {
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
      <SiteStudioBoard />
    </div>
  );
}
