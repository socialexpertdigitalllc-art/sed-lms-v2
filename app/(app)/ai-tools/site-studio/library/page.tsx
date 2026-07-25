import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { StudioTabs } from "@/components/site-studio/StudioTabs";
import { AssetLibrary } from "@/components/site-studio/AssetLibrary";

export const dynamic = "force-dynamic";

export default async function SiteStudioLibraryPage() {
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
      <AssetLibrary />
    </div>
  );
}
