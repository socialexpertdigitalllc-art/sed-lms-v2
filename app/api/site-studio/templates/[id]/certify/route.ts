import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import type { Diagnostic } from "@/lib/site-studio/schema";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data: row } = await admin.from("studio_templates").select("id,name,status,diagnostics,manifest").eq("id", id).single();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.status !== "needs_review") return NextResponse.json({ error: "Only a reviewed template can be certified" }, { status: 409 });
  if (!row.manifest) return NextResponse.json({ error: "Template has no compiled package" }, { status: 409 });
  const blockers = ((row.diagnostics ?? []) as Diagnostic[]).filter((d) => d.level === "blocker");
  if (blockers.length > 0) {
    return NextResponse.json({ error: `Cannot certify with ${blockers.length} blocking diagnostic(s)`, blockers }, { status: 409 });
  }

  const { data: updated, error } = await admin.from("studio_templates").update({
    status: "certified",
    certified_by: auth.userId,
    certified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", id).select("*").single();
  if (error || !updated) return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "studio.template.certified",
    entity_type: "studio_template",
    entity_id: id,
    new_value: { name: row.name },
  });
  return NextResponse.json({ template: updated });
}
