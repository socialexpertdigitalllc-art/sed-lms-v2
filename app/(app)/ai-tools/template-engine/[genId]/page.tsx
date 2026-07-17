import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { GenerationWizard } from "@/components/template-engine/wizard/GenerationWizard";

export const dynamic = "force-dynamic";

// One generation's 5-step workspace. The row is loaded client-side (the
// wizard re-fetches live), but we gate + 404 server-side so a bad link never
// mounts the client shell.
export default async function GenerationWizardPage({
  params,
}: {
  params: Promise<{ genId: string }>;
}) {
  const { genId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.generate") && !perms.has("templates.manage")) redirect("/dashboard");

  const admin = createAdminClient();
  const { data: gen } = await admin
    .from("template_generations")
    .select("id")
    .eq("id", genId)
    .maybeSingle();
  if (!gen) notFound();

  return <GenerationWizard key={genId} genId={genId} canDeploy={perms.has("templates.deploy")} />;
}
