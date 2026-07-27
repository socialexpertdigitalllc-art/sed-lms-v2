import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";

export const runtime = "nodejs";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/**
 * CAS from "review" to "approved". `.eq("status", "review")` means a double
 * approve, or approving a run that failed/was deleted meanwhile, updates
 * zero rows rather than corrupting state — that's a 409, not a silent no-op
 * (same idiom as app/api/site-studio/runs/[id]/approve/route.ts).
 */
export async function POST(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("builder_runs")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "review")
    .select("*")
    .single();

  if (error || !updated) {
    const { data: current } = await admin.from("builder_runs").select("status").eq("id", id).single();
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(
      { error: `Cannot approve: this run is "${current.status}", not "review".` },
      { status: 409 },
    );
  }

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "site_builder.run.approved",
    entity_type: "builder_run",
    entity_id: id,
    new_value: { status: "approved" },
  });

  return NextResponse.json({ run: updated });
}
