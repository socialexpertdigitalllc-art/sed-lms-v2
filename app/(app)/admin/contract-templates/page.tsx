import { redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/common/Panel";
import { btnSecondary } from "@/components/common/buttons";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getAppSettings } from "@/lib/settings/appSettings";
import { getGoogleStatus } from "@/lib/google/connection";
import { getFolderMeta, listFolderFiles, GOOGLE_DOC_MIME } from "@/lib/google/drive";
import { ContractTemplatesManager, type AvailableDoc, type RegisteredTemplate } from "@/components/contracts/ContractTemplatesManager";
import { PlaceholderCatalog } from "@/components/contracts/PlaceholderCatalog";
import type { ContractPlaceholderRow } from "@/lib/contracts/placeholders";

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

  const { data: customRaw } = await admin
    .from("contract_placeholders")
    .select("id, token, lead_field, label, created_at")
    .order("token", { ascending: true });
  const customPlaceholders = (customRaw ?? []) as ContractPlaceholderRow[];

  // Diagnose rather than swallow: an empty list can mean "folder not visible to
  // the connected account", "folder has no Google Docs", or an outright Drive
  // error — and an operator staring at a blank panel can't tell which.
  let available: AvailableDoc[] = [];
  const folderMissing = !folderId;
  let folderNotAccessible = false;
  let loadError: string | null = null;

  if (folderId && status.connected) {
    try {
      const folder = await getFolderMeta(folderId);
      if (!folder) {
        folderNotAccessible = true;
      } else {
        const files = await listFolderFiles(folderId);
        available = files.map((f) => ({
          id: f.id,
          name: f.name,
          modifiedTime: f.modifiedTime,
          mimeType: f.mimeType,
          isDoc: f.mimeType === GOOGLE_DOC_MIME,
          registered: registeredIds.has(f.id),
        }));
      }
    } catch (e) {
      loadError = (e as Error).message;
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="Contract Templates"
        description={
          <>
            Connect Google, point at a Drive folder of template docs, and register the ones agents can use. Contracts copy the doc, fill{" "}
            <span className="font-mono text-xs">{"{{placeholders}}"}</span>, and export a PDF.
          </>
        }
        action={
          folderId ? (
            <a
              href={`https://drive.google.com/drive/folders/${folderId}`}
              target="_blank"
              rel="noreferrer"
              className={btnSecondary}
            >
              <ExternalLink className="h-4 w-4" /> Open Drive folder
            </a>
          ) : undefined
        }
      />
      <ContractTemplatesManager
        status={status}
        folderId={folderId}
        available={available}
        folderMissing={folderMissing}
        folderNotAccessible={folderNotAccessible}
        loadError={loadError}
        registered={registered}
        customTokens={customPlaceholders.map((p) => p.token)}
      />
      <PlaceholderCatalog custom={customPlaceholders} />
    </div>
  );
}
