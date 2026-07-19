import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getAppSettings } from "@/lib/settings/appSettings";
import { listDocsInFolder } from "@/lib/google/drive";

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

  try {
    const docs = await listDocsInFolder(folderId);
    return NextResponse.json({
      docs: docs.map((d) => ({ ...d, registered: registeredIds.has(d.id) })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, docs: [] }, { status: 502 });
  }
}
