import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/Panel";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { listProviderSettings } from "@/lib/email-verify/adminView";
import { ProviderManager } from "@/components/email-verify/ProviderManager";
import { UsageDashboard } from "@/components/email-verify/UsageDashboard";

export const dynamic = "force-dynamic";

export default async function EmailProvidersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) redirect("/dashboard");

  // Client-safe by construction: this shape has no field that could carry a
  // credential — only `configured` and a masked hint.
  const providers = await listProviderSettings();

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="Email Verification"
        description="Local checks are free and always run. These providers add mailbox-level confirmation — set the order they are tried in, store their credentials, and watch what the free tiers have left."
      />
      <ProviderManager providers={providers} />
      <UsageDashboard />
    </div>
  );
}
