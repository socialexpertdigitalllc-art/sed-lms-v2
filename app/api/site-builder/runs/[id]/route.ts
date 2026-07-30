import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { BUILDER_SITES_BUCKET, outputPathFor, STALE_GENERATING_MS } from "@/lib/site-builder/run";

export const runtime = "nodejs";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data, error } = await admin.from("builder_runs").select("*").eq("id", id).single();
  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ run: data });
}

/**
 * PATCH — per-run operator preferences: `{ auto_resume: boolean }`, merged
 * into `options`. `auto_resume` gates the background processor's automatic
 * resumption of a PARKED run (failed + `resume_at`); absent means true, so
 * the toggle only ever needs to write the explicit value.
 *
 * Read-modify-write on `options` rather than a JSON-merge expression. The
 * race is benign: `options` carries only operator preferences, the engine
 * never writes the column, and two concurrent toggles losing one another
 * just means the older click loses — which is what it deserves.
 *
 * `updated_at` is deliberately NOT stamped: it is the liveness clock for the
 * stale-reclaim rule and the delete grace, and a preference toggle must not
 * make a dead "generating" run look alive (nor 409 a claim CAS in flight).
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as { auto_resume?: unknown } | null;
  if (!body || typeof body.auto_resume !== "boolean") {
    return NextResponse.json({ error: "Expected { auto_resume: boolean }" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: run, error: fetchErr } = await admin.from("builder_runs").select("id, options").eq("id", id).single();
  if (fetchErr || !run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const options = { ...((run.options as Record<string, unknown> | null) ?? {}), auto_resume: body.auto_resume };
  const { data: updated, error: updErr } = await admin
    .from("builder_runs")
    .update({ options })
    .eq("id", id)
    .select("*")
    .single();
  if (updErr || !updated) return NextResponse.json({ error: updErr?.message ?? "Update failed" }, { status: 400 });

  return NextResponse.json({ run: updated });
}

/** An actively-generating run may not be deleted out from under itself —
 *  unless its row hasn't moved for this long, in which case the generation
 *  is presumed dead (server restart) and the run is just debris.
 *
 *  This IS the generate route's staleness rule, shared rather than restated:
 *  the two used to be separate literals and drifted apart, leaving deletion at
 *  ten minutes long after claiming was raised to sixty — so a healthy paced run
 *  (which can legitimately write nothing for ~21 minutes) was deletable while
 *  still working. Anything shorter than the reclaim window is wrong here by
 *  construction. */
const ACTIVE_GRACE_MS = STALE_GENERATING_MS;

/**
 * DELETE — remove a run entirely: its output zip in storage, then its row.
 * Deleting a DEPLOYED run does NOT take the live site down — that is the
 * deployments board's job (`studio_deployments` has its own takedown); this
 * only forgets the generation record.
 */
export async function DELETE(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data: run, error: fetchErr } = await admin
    .from("builder_runs")
    .select("id, status, output_path, lead_id, updated_at")
    .eq("id", id)
    .single();
  if (fetchErr || !run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const active = run.status === "queued" || run.status === "generating";
  const fresh = Date.now() - new Date(run.updated_at as string).getTime() < ACTIVE_GRACE_MS;
  if (active && fresh) {
    return NextResponse.json(
      {
        error:
          "This run is still generating — wait for it to finish, or use Stop and recover to release it, then delete it.",
      },
      { status: 409 },
    );
  }

  // Storage first, row second: an orphaned zip with no row would be
  // invisible debris, a row whose zip is already gone is still deletable.
  const path = (run.output_path as string | null) ?? outputPathFor(id);
  await admin.storage.from(BUILDER_SITES_BUCKET).remove([path]);

  const { error: delErr } = await admin.from("builder_runs").delete().eq("id", id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "site_builder.run.deleted",
    entity_type: "builder_run",
    entity_id: id,
    new_value: { status: run.status, lead_id: run.lead_id },
  });

  return NextResponse.json({ ok: true });
}
