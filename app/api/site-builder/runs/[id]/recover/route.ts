import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";

export const runtime = "nodejs";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Force-release a run wedged in "generating", so the operator can retry it
 * without waiting out STALE_GENERATING_MS (see the generate route).
 *
 * Deliberately SEPARATE from retry. Force-releasing a claim is a different
 * decision from re-running, and it carries a risk retry does not: the run may
 * still be working. A rate-paced run can legitimately go about twenty minutes
 * without writing to its row, so this action must be SAFE to take on a live
 * generation — which is what `generation_id` provides. Nulling it means the
 * in-flight attempt's own writes match zero rows and are discarded, rather
 * than racing whatever the operator does next (see migration 0063).
 *
 * Whatever that attempt had finished but not yet persisted is lost. Whatever it
 * HAD persisted survives in `pages` and is carried forward by the next
 * `/generate` (see `resume`), which is why this leaves the run at "failed"
 * rather than clearing its pages: retrying is then cheap, not a fresh start.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data: run, error: fetchErr } = await admin.from("builder_runs").select("*").eq("id", id).single();
  if (fetchErr || !run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (run.status !== "generating") {
    return NextResponse.json(
      { error: `Cannot recover: this run is "${run.status}", not "generating".` },
      { status: 409 },
    );
  }

  const { data: updated, error: updErr } = await admin
    .from("builder_runs")
    .update({
      status: "failed",
      generation_id: null,
      error:
        "Recovered while it was still generating. Anything the interrupted attempt had not yet saved was abandoned; retry to finish the remaining pages.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "generating")
    .select("*")
    .maybeSingle();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });
  if (!updated) {
    // Someone else moved it between our read and our write — most likely the
    // very generation we were about to release, finishing on its own.
    return NextResponse.json({ error: "This run changed while recovering it. Reload and try again." }, { status: 409 });
  }

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "site_builder.run.recovered",
    entity_type: "builder_run",
    entity_id: id,
    new_value: { from: "generating", to: "failed" },
  });

  return NextResponse.json({ run: updated });
}
