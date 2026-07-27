import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { canTransition, STUDIO_STATUSES } from "@/lib/site-studio/service/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as { status?: string } | null;
  const to = body?.status ?? "";
  if (!(STUDIO_STATUSES as readonly string[]).includes(to)) {
    return NextResponse.json({ error: "Unknown status" }, { status: 422 });
  }

  const admin = createAdminClient();
  const { data: row } = await admin.from("studio_templates").select("id,status").eq("id", id).single();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canTransition(row.status, to)) {
    return NextResponse.json({ error: `Cannot move a ${row.status} template to ${to}` }, { status: 409 });
  }

  const { data: updated, error } = await admin.from("studio_templates").update({
    status: to,
    updated_at: new Date().toISOString(),
  }).eq("id", id).select("*").single();
  if (error || !updated) return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "studio.template.status",
    entity_type: "studio_template",
    entity_id: id,
    new_value: { from: row.status, to },
  });
  return NextResponse.json({ template: updated });
}
