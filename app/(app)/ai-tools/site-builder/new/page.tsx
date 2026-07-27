import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { BuilderTabs } from "@/components/site-builder/BuilderTabs";
import { NewSiteFlow } from "@/components/site-builder/NewSiteFlow";

export const dynamic = "force-dynamic";

export default async function SiteBuilderNewPage() {
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
      <NewSiteFlow />
    </div>
  );
}
