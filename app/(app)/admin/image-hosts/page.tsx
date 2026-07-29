import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/Panel";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { listImageHostStatuses } from "@/lib/photo-capture/hosts/config";
import { ImageHostsPanel } from "@/components/admin/ImageHostsPanel";

export const dynamic = "force-dynamic";

export default async function ImageHostsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) redirect("/dashboard");

  // Client-safe by construction: `listImageHostStatuses` never includes a
  // credential, only `configured` and a masked hint.
  const hosts = await listImageHostStatuses();

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="Image Hosts"
        description="Where captured Google Business Profile photos are re-hosted before they're used on a generated site."
      />
      <ImageHostsPanel hosts={hosts} />
    </div>
  );
}
