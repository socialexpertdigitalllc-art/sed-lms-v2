import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { removeAllFiles } from "@/lib/site-studio/service/templates";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data, error } = await admin.from("studio_templates").select("*").eq("id", id).single();
  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ template: data });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as { name?: string; niche_tags?: string[] } | null;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body?.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (Array.isArray(body?.niche_tags)) patch.niche_tags = body.niche_tags.filter((t) => typeof t === "string" && t.trim()).slice(0, 20);
  if (Object.keys(patch).length === 1) return NextResponse.json({ error: "Nothing to update" }, { status: 422 });

  const admin = createAdminClient();
  const { data, error } = await admin.from("studio_templates").update(patch).eq("id", id).select("*").single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Not found" }, { status: 404 });
  return NextResponse.json({ template: data });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data: row } = await admin.from("studio_templates").select("id,name").eq("id", id).single();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Phase 2: no generations exist yet, so delete is unconditional. Phase 3
  // adds the "block while any run uses it" guard (the proven v2 rule).
  await removeAllFiles(admin, id).catch(() => {}); // storage cleanup is best-effort
  const { error } = await admin.from("studio_templates").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "studio.template.deleted",
    entity_type: "studio_template",
    entity_id: id,
    new_value: { name: row.name },
  });
  return NextResponse.json({ ok: true });
}
