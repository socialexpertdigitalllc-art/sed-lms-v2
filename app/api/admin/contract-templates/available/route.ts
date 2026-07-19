import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getAppSettings } from "@/lib/settings/appSettings";
import { getFolderMeta, listFolderFiles, GOOGLE_DOC_MIME } from "@/lib/google/drive";
import { getGoogleConnection } from "@/lib/google/connection";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const settings = await getAppSettings();
  const folderId = settings.contract_templates_folder_id;
  if (!folderId) return NextResponse.json({ folderMissing: true, docs: [] });

  const admin = createAdminClient();
  const { data: registered } = await admin.from("contract_templates").select("google_doc_id");
  const registeredIds = new Set((registered ?? []).map((r) => r.google_doc_id));

  const conn = await getGoogleConnection();
  const account = conn?.account_email ?? null;

  try {
    // Look the folder up first: "cannot see it" (wrong account / not shared) and
    // "it has no Google Docs" are indistinguishable from a file list alone, and
    // that ambiguity is exactly what leaves an operator staring at an empty page.
    const folder = await getFolderMeta(folderId);
    if (!folder) {
      return NextResponse.json({
        docs: [],
        account,
        folderNotAccessible: true,
        folderId,
      });
    }

    // List EVERY file so non-Doc files (e.g. uploaded .docx) can be shown as
    // unusable-with-a-reason rather than silently filtered into nothing.
    const files = await listFolderFiles(folderId);
    return NextResponse.json({
      account,
      folder,
      totalFiles: files.length,
      docs: files.map((f) => ({
        id: f.id,
        name: f.name,
        modifiedTime: f.modifiedTime,
        mimeType: f.mimeType,
        isDoc: f.mimeType === GOOGLE_DOC_MIME,
        registered: registeredIds.has(f.id),
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, docs: [], account }, { status: 502 });
  }
}
