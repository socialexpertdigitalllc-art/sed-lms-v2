import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { STUDIO_BUCKET, sourcePath } from "@/lib/site-studio/service/templates";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_ZIP_BYTES = 25 * 1024 * 1024;

export async function GET() {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("studio_templates")
    .select("id,name,status,version,niche_tags,diagnostics,compiled_at,identity_enriched_at,semantics_enriched_at,certified_at,created_at,updated_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const form = await req.formData();
  const file = form.get("file");
  const name = String(form.get("name") ?? "").trim();
  if (!(file instanceof File)) return NextResponse.json({ error: "A template zip file is required" }, { status: 422 });
  if (!name) return NextResponse.json({ error: "A template name is required" }, { status: 422 });
  if (file.size > MAX_ZIP_BYTES) return NextResponse.json({ error: "Template zip must be 25MB or smaller" }, { status: 422 });

  const bytes = new Uint8Array(await file.arrayBuffer());

  const admin = createAdminClient();
  const id = crypto.randomUUID();
  const { error: upErr } = await admin.storage
    .from(STUDIO_BUCKET)
    .upload(sourcePath(id), bytes, { contentType: "application/zip", upsert: false });
  if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });

  const { data: row, error: insErr } = await admin
    .from("studio_templates")
    .insert({ id, name, storage_prefix: id, status: "uploaded", created_by: auth.userId })
    .select("*")
    .single();
  if (insErr || !row) {
    await admin.storage.from(STUDIO_BUCKET).remove([sourcePath(id)]);
    return NextResponse.json({ error: insErr?.message ?? "Create failed" }, { status: 400 });
  }

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "studio.template.uploaded",
    entity_type: "studio_template",
    entity_id: id,
    new_value: { name, bytes: file.size },
  });

  return NextResponse.json({ template: row }, { status: 201 });
}
