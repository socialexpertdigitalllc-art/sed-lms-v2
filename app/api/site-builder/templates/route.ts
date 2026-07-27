import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { storeTemplate, listTemplates } from "@/lib/site-builder/templates";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_ZIP_BYTES = 25 * 1024 * 1024;

export async function GET() {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const admin = createAdminClient();
  try {
    const templates = await listTemplates(admin);
    return NextResponse.json({ templates });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "List failed" }, { status: 400 });
  }
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

  try {
    const template = await storeTemplate(admin, { name, bytes, createdBy: auth.userId });
    await admin.from("activity_log").insert({
      user_id: auth.userId,
      action: "site_builder.template.uploaded",
      entity_type: "builder_template",
      entity_id: template.id,
      new_value: { name, bytes: file.size, page_files: template.page_files.length, asset_files: template.asset_files.length },
    });
    return NextResponse.json({ template }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 500 });
  }
}
