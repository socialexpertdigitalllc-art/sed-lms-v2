import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getDocText } from "@/lib/google/docs";
import { extractPlaceholders } from "@/lib/contracts/placeholders";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { data: row } = await admin.from("contract_templates").select("google_doc_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  let doc: { title: string; text: string };
  try {
    doc = await getDocText(row.google_doc_id);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  const { data, error } = await admin
    .from("contract_templates")
    .update({ name: doc.title || "Untitled template", placeholders: extractPlaceholders(doc.text), synced_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, google_doc_id, name, placeholders, synced_at")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });
  return NextResponse.json({ template: data });
}
