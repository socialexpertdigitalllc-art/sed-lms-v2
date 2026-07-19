import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getAppSettings } from "@/lib/settings/appSettings";
import { getGoogleStatus } from "@/lib/google/connection";
import { listDocsInFolder } from "@/lib/google/drive";
import { ContractTemplatesManager, type AvailableDoc, type RegisteredTemplate } from "@/components/contracts/ContractTemplatesManager";

export default async function ContractTemplatesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) redirect("/dashboard");

  const admin = createAdminClient();
  const status = await getGoogleStatus();
  const settings = await getAppSettings();
  const folderId = settings.contract_templates_folder_id ?? "";

  const { data: registeredRaw } = await admin
    .from("contract_templates")
    .select("id, google_doc_id, name, placeholders, synced_at")
    .order("name", { ascending: true });
  const registered = (registeredRaw ?? []) as RegisteredTemplate[];
  const registeredIds = new Set(registered.map((r) => r.google_doc_id));

  let available: AvailableDoc[] = [];
  let folderMissing = !folderId;
  if (folderId && status.connected) {
    try {
      const docs = await listDocsInFolder(folderId);
      available = docs.map((d) => ({ ...d, registered: registeredIds.has(d.id) }));
    } catch {
      available = [];
    }
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-text">Contract Templates</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Connect Google, point at a Drive folder of template docs, and register the ones agents can use. Contracts copy the doc, fill{" "}
          <span className="font-mono text-xs">{"{{placeholders}}"}</span>, and export a PDF.
        </p>
      </div>
      <ContractTemplatesManager status={status} folderId={folderId} available={available} folderMissing={folderMissing} registered={registered} />
    </div>
  );
}
