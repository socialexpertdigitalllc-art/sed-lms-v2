import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardAny, guardError } from "@/lib/site-studio/service/guard";
import { deleteTemplate, updateTemplate, COVER_TYPES, TEMPLATE_CATALOGUE_PERMS } from "@/lib/site-builder/templates";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_ZIP_BYTES = 25 * 1024 * 1024;
const MAX_COVER_BYTES = 5 * 1024 * 1024;

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET — one template by id, whatever its in-service state.
 *
 * The lead screen shows the template sales recommended for a lead; that
 * template may since have gone out of service, so the in-service list is
 * not enough to name it. Read-only and gated like the catalogue reads
 * (studio.manage or leads.create).
 */
export async function GET(_req: Request, ctx: Ctx) {
  const auth = await guardAny(TEMPLATE_CATALOGUE_PERMS);
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data, error } = await admin.from("builder_templates").select("*").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  return NextResponse.json({ template: data });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  try {
    await deleteTemplate(admin, id);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Delete failed" }, { status: 400 });
  }

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "site_builder.template.deleted",
    entity_type: "builder_template",
    entity_id: id,
  });

  return NextResponse.json({ ok: true });
}

/**
 * PATCH — edit a template.
 *
 * Two shapes, because two different things are being changed:
 *
 *  - JSON `{ in_service }` toggles the switch. "In service" is the ONLY thing
 *    sales sees: an off template is absent from the lead form entirely, not
 *    greyed out. Turning it on is a claim that someone has looked at the
 *    template and would put it in front of a client, which is why it cannot
 *    be turned on without a cover to show them.
 *
 *  - multipart/form-data carries `name`, `cover` and/or `file` (a new source
 *    zip). Covers became required for new uploads, so without this path the
 *    templates uploaded before that could never get one — and could therefore
 *    never go in service at all.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    return patchFiles(req, id, auth.userId);
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body?.in_service !== "boolean") {
    return NextResponse.json({ error: "in_service must be true or false" }, { status: 422 });
  }
  const admin = createAdminClient();

  if (body.in_service) {
    const { data: row } = await admin
      .from("builder_templates")
      .select("cover_image_path")
      .eq("id", id)
      .maybeSingle();
    if (!row) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    if (!row.cover_image_path) {
      return NextResponse.json(
        { error: "Add a cover image before putting this template in service — sales pick by picture." },
        { status: 422 },
      );
    }
  }

  const { data, error } = await admin
    .from("builder_templates")
    .update({ in_service: body.in_service })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });
  }

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: body.in_service ? "site_builder.template.in_service" : "site_builder.template.out_of_service",
    entity_type: "builder_template",
    entity_id: id,
  });

  return NextResponse.json({ template: data });
}

/** The multipart half of PATCH: rename, re-cover, or ship updated files. */
async function patchFiles(req: Request, id: string, userId: string | null) {
  const form = await req.formData();
  const rawName = form.get("name");
  const coverFile = form.get("cover");
  const zipFile = form.get("file");

  const input: Parameters<typeof updateTemplate>[2] = {};

  if (typeof rawName === "string" && rawName.trim()) input.name = rawName;

  if (coverFile instanceof File && coverFile.size > 0) {
    const ext = COVER_TYPES[coverFile.type];
    if (!ext) {
      return NextResponse.json({ error: "Cover must be a PNG, JPEG, WebP or AVIF image" }, { status: 422 });
    }
    if (coverFile.size > MAX_COVER_BYTES) {
      return NextResponse.json({ error: "Cover image must be 5MB or smaller" }, { status: 422 });
    }
    input.cover = {
      bytes: new Uint8Array(await coverFile.arrayBuffer()),
      ext,
      contentType: coverFile.type,
    };
  }

  if (zipFile instanceof File && zipFile.size > 0) {
    if (zipFile.size > MAX_ZIP_BYTES) {
      return NextResponse.json({ error: "Template zip must be 25MB or smaller" }, { status: 422 });
    }
    input.zip = new Uint8Array(await zipFile.arrayBuffer());
  }

  if (Object.keys(input).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 422 });
  }

  const admin = createAdminClient();
  let template;
  try {
    template = await updateTemplate(admin, id, input);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Update failed";
    return NextResponse.json({ error: message }, { status: /not found/i.test(message) ? 404 : 400 });
  }

  await admin.from("activity_log").insert({
    user_id: userId,
    action: "site_builder.template.updated",
    entity_type: "builder_template",
    entity_id: id,
    new_value: {
      renamed: input.name !== undefined,
      cover_replaced: !!input.cover,
      files_replaced: !!input.zip,
    },
  });

  return NextResponse.json({ template });
}
