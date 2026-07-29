import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";

export const runtime = "nodejs";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Force-release a run whose generation claim is stuck, so the operator can use
 * it again without waiting out STALE_GENERATING_MS (see the generate route).
 *
 * TWO shapes of stuck, and both are recovered here:
 *
 *  1. STATUS "generating" — the ordinary case. The run is claimed and the
 *     operator does not want to wait. This is deliberately SEPARATE from
 *     retry: force-releasing a claim is a different decision from re-running,
 *     and it carries a risk retry does not, because the run may still be
 *     working. A rate-paced run can legitimately go about twenty minutes
 *     without writing to its row, so this action must be SAFE to take on a
 *     live generation — which is what `generation_id` provides. Nulling it
 *     means the in-flight attempt's own writes match zero rows and are
 *     discarded, rather than racing whatever the operator does next (see
 *     migration 0063). Such a run is left at "failed" with a retryable
 *     message; whatever the attempt had persisted survives in `pages` and is
 *     carried forward by the next `/generate` (see `resume`), so retrying is
 *     cheap rather than a fresh start.
 *
 *  2. A DANGLING TOKEN on a run that is no longer "generating" — the wedge
 *     this route is the only escape from. /generate writes "review" and
 *     deliberately KEEPS its token while it uploads the zip, nulling it only
 *     afterwards; a process that dies in that window (restart, deploy, OOM
 *     mid-upload) leaves the row "review" with a token nobody owns. The
 *     per-page regenerate route then matches zero rows and 409s FOREVER,
 *     telling the operator to wait for a generation that no longer exists,
 *     while /generate refuses a "review" run outright. Clearing the token is
 *     all such a run needs, so its STATUS IS LEFT ALONE: demoting a run that
 *     already has a reviewable site to "failed" would throw away the operator's
 *     place in the flow to fix a bookkeeping leak.
 *
 * A run that is neither — no token, not generating — has nothing to release
 * and is refused, so this stays a repair tool rather than a way to reset an
 * ordinary run.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data: run, error: fetchErr } = await admin.from("builder_runs").select("*").eq("id", id).single();
  if (fetchErr || !run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const wedged = run.status === "generating";
  const danglingToken = (run.generation_id as string | null) != null;
  if (!wedged && !danglingToken) {
    return NextResponse.json(
      {
        error: `Cannot recover: this run is "${run.status}", not "generating", and holds no generation claim to release.`,
      },
      { status: 409 },
    );
  }

  /**
   * The CAS matches whichever condition got us here, so the write stays
   * race-safe in both:
   *
   *  - a "generating" run is guarded on that status, because the race that
   *    matters is the very generation we are disowning reaching "review" on
   *    its own in the gap since our read (stamping "failed" over a published
   *    run would be unrecoverable);
   *  - a dangling token is guarded on the token's own value, because the race
   *    that matters there is somebody else clearing or replacing it — and the
   *    run's status is not ours to constrain, it is precisely what we are
   *    leaving alone.
   */
  const patch = wedged
    ? {
        status: "failed",
        generation_id: null,
        error:
          "Recovered while it was still generating. Anything the interrupted attempt had not yet saved was abandoned; retry to finish the remaining pages.",
        updated_at: new Date().toISOString(),
      }
    : { generation_id: null, updated_at: new Date().toISOString() };

  const write = admin.from("builder_runs").update(patch).eq("id", id);
  const guarded = wedged
    ? write.eq("status", "generating")
    : write.eq("generation_id", run.generation_id as string);

  const { data: updated, error: updErr } = await guarded.select("*").maybeSingle();
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
    new_value: { from: run.status, to: updated.status },
  });

  return NextResponse.json({ run: updated });
}
