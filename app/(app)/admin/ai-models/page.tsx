import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/Panel";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { listAiRoutingSettings } from "@/lib/ai-tools/providers/adminView";
import { AiModelManager } from "@/components/ai-models/AiModelManager";

export const dynamic = "force-dynamic";

export default async function AiModelsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) redirect("/dashboard");

  // Client-safe by construction: this shape has no field that could carry a
  // credential — only `configured` and a masked hint.
  const { providers, tasks } = await listAiRoutingSettings();

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="AI Models"
        description="Register providers with their own API keys and point each AI task at whichever model suits it — to spread load and cost. Only models that can actually do a job are offered for it, and anything unusable falls back to the default rather than breaking a generation."
      />
      <AiModelManager providers={providers} tasks={tasks} />
    </div>
  );
}
