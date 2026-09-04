import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardAny, guardError } from "@/lib/site-studio/service/guard";
import { storeTemplate, listTemplates, COVER_TYPES, TEMPLATE_CATALOGUE_PERMS } from "@/lib/site-builder/templates";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_ZIP_BYTES = 25 * 1024 * 1024;
/** A cover is a screenshot, not a photo library — 5MB is generous for one. */
const MAX_COVER_BYTES = 5 * 1024 * 1024;

export async function GET(req: Request) {
  // `?in_service=1` is what the LEAD FORM asks for — never the whole catalogue.
  // That one read is open to anyone who can create a lead; the whole
  // catalogue (out-of-service templates included) stays studio-only.
  const inServiceOnly = new URL(req.url).searchParams.get("in_service") === "1";
  const auth = inServiceOnly ? await guardAny(TEMPLATE_CATALOGUE_PERMS) : await guard();
  if ("error" in auth) return guardError(auth.error);

  const admin = createAdminClient();
  try {
    const templates = await listTemplates(admin, { inServiceOnly });
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
  const coverFile = form.get("cover");
  if (!(file instanceof File)) return NextResponse.json({ error: "A template zip file is required" }, { status: 422 });
  if (!name) return NextResponse.json({ error: "A template name is required" }, { status: 422 });
  if (file.size > MAX_ZIP_BYTES) return NextResponse.json({ error: "Template zip must be 25MB or smaller" }, { status: 422 });

  // Required, not optional: sales pick from a wall of pictures, and a
  // template with no picture is a template nobody can choose.
  if (!(coverFile instanceof File)) {
    return NextResponse.json({ error: "A cover image is required" }, { status: 422 });
  }
  const ext = COVER_TYPES[coverFile.type];
  if (!ext) {
    return NextResponse.json({ error: "Cover must be a PNG, JPEG, WebP or AVIF image" }, { status: 422 });
  }
  if (coverFile.size > MAX_COVER_BYTES) {
    return NextResponse.json({ error: "Cover image must be 5MB or smaller" }, { status: 422 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const admin = createAdminClient();

  try {
    const template = await storeTemplate(admin, {
      name,
      bytes,
      createdBy: auth.userId,
      cover: {
        bytes: new Uint8Array(await coverFile.arrayBuffer()),
        ext,
        contentType: coverFile.type,
      },
    });
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
