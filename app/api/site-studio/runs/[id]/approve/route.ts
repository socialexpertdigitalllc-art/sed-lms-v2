import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";

export const runtime = "nodejs";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Releases Gate 1: CAS from "reviewing" to "approved" — the same optimistic
 * pattern the engine's own `claimRun` uses, applied here to the STATUS
 * column instead of `updated_at` (approve is a one-shot human action, not a
 * machine step claim). `.eq("status", "reviewing")` means a double-click, or
 * an operator approving a run that the advancer/another tab already moved
 * on, updates ZERO rows rather than corrupting an already-advanced run —
 * that's a 409, not a silent no-op. Body is intentionally empty: approval is
 * whole-run (per-page partial approval is not in the 3b spec).
 */
export async function POST(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("studio_runs")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "reviewing")
    .select("*")
    .single();

  if (error || !updated) {
    const { data: current } = await admin.from("studio_runs").select("status").eq("id", id).single();
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(
      { error: `Cannot approve: this run is "${current.status}", not "reviewing" (it may already have advanced).` },
      { status: 409 },
    );
  }

  await admin.from("studio_run_events").insert({
    run_id: id,
    step: "gate",
    level: "info",
    message: "gate_closed",
  });
  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "studio.run.approved",
    entity_type: "studio_run",
    entity_id: id,
    new_value: { status: "approved" },
  });

  return NextResponse.json({ run: updated });
}
