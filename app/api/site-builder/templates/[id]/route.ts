import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { deleteTemplate } from "@/lib/site-builder/templates";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

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
 * PATCH — the in-service switch.
 *
 * "In service" is the ONLY thing sales sees: an off template is absent from
 * the lead form entirely, not greyed out. Turning it on is a claim that
 * someone has looked at the template and would put it in front of a client,
 * which is why it cannot be turned on without a cover to show them.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

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
