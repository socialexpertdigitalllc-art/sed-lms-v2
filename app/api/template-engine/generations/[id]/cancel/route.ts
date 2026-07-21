import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import {
  isCancellableStatus, isAtRestStatus, releasePendingQueue, CANCELLABLE_STATUSES,
} from "@/lib/template-engine/control";
import { abortGeneration } from "@/lib/template-engine/abortRegistry";
import { removeGenerationArtifacts } from "@/lib/template-engine/cleanup";
import { isOrphaned } from "@/lib/template-engine/liveness";
import { forceResolveGeneration } from "@/lib/template-engine/forceResolve";

interface GenRow {
  id: string;
  lead_id: string;
  status: string;
  heartbeat_at?: string | null;
  updated_at?: string | null;
}

// POST /api/template-engine/generations/[id]/cancel — stop a generation for
// good, IMMEDIATELY. Same two-step mechanism as /pause (write
// `template_generations.control`, then abort the runner's controller in
// process), but the run comes to rest at `cancelled` instead of `paused` and is
// not resumable.
//
// The difference that matters: a cancel DELETES the run's partial build
// artefacts. Aborting mid-flight can interrupt `finalize` between the zip and
// the per-file explode, and a half-uploaded site under
// `template-sites/<id>/` must never be downloaded or deployed — so the objects
// go and `zip_path` is nulled. Best-effort: a bucket that refuses to delete
// does not stop the cancel from being recorded. /retry still accepts a
// cancelled run, so this is recoverable, just not by pressing Resume.
//
// The case that needs its own handling: a generation that is still `queued`, or
// resting at `curating`/`paused`. No runner is executing it, so nobody would
// ever read the flag; the route deletes the pending queue row and makes the
// `cancelled` transition itself.
//
// THE DEAD-RUNNER CASE (the production incident, see liveness.ts). An IN-FLIGHT
// status used to mean "a runner will read the flag" — true right up until the
// process is replaced mid-build, after which the flag has no reader and the run
// is unstoppable forever. So this route no longer assumes: it checks
// `heartbeat_at`, and if the run has gone silent it force-resolves it here and
// says so, distinctly, in the response (`forced: true`). `{ force: true }` in the
// body does the same thing regardless of the heartbeat, for an operator who
// knows the runner is gone before the threshold has elapsed.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.generate")) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  // `force` is an escape hatch, not a separate capability: it performs the same
  // writes this route already performs, so it is gated by the same permission
  // checked above. A body is optional (the UI's normal Stop sends none).
  const body = (await req.json().catch(() => null)) as { force?: unknown } | null;
  const forced = body?.force === true;

  const admin = createAdminClient();
  const { data: genRow } = await admin
    .from("template_generations")
    // `*` rather than a column list on purpose: `heartbeat_at` only exists once
    // migration 0047 is applied, and naming a missing column would make this
    // select ERROR and turn every Stop into a 404 on a database that is one
    // deploy behind. With `*` the column is simply absent, isOrphaned() falls
    // back to the row's age, and Stop keeps working.
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!genRow) return NextResponse.json({ error: "Generation not found" }, { status: 404 });
  const gen = genRow as GenRow;

  // RLS-scoped lookup: a lead this user cannot see must 404, not cancel.
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", gen.lead_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  if (!isCancellableStatus(gen.status)) {
    return NextResponse.json({ error: "This run has already finished" }, { status: 409 });
  }

  // CAS on the cancellable set: a run that reached `review` (or failed) between
  // the read and this write must not be flagged.
  const { data: flagged, error } = await admin
    .from("template_generations")
    .update({ control: "cancel", updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", CANCELLABLE_STATUSES as unknown as string[])
    .select("id, status")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!flagged) return NextResponse.json({ error: "This run has already finished" }, { status: 409 });

  // Kill the live run now. The runner's own catch does the artefact cleanup for
  // this path, because only it knows when the aborted upload actually stopped.
  const abortedInProcess = abortGeneration(id, "cancel");

  // A run whose heartbeat has gone silent has no reader for the flag we just
  // wrote. Do NOT wait for a runner that no longer exists — finish the job here.
  // `abortedInProcess` is proof of life and overrides the heartbeat: a runner in
  // THIS process is unambiguously alive and about to unwind on its own.
  const dead =
    !abortedInProcess &&
    (forced || isOrphaned({ status: gen.status, heartbeatAt: gen.heartbeat_at, updatedAt: gen.updated_at }));
  if (dead) {
    const reason = forced
      ? "Force-stopped by an operator — the run was not responding."
      : "Stopped automatically: the run stopped reporting activity (its process was gone), so it could not stop itself.";
    const resolved = await forceResolveGeneration(admin, id, {
      mode: "cancel",
      // Any status it could legally be cancelled from — including the at-rest
      // ones, so a forced stop works on a queued/curating run too.
      from: CANCELLABLE_STATUSES,
      reason,
    });
    if (resolved) {
      return NextResponse.json({ ok: true, status: "cancelled", forced: true, reason }, { status: 200 });
    }
  }

  if (isAtRestStatus(flagged.status as string)) {
    const { runnerInFlight } = await releasePendingQueue(admin, id);
    if (!runnerInFlight) {
      // Queued-but-never-started (or resting at curating/paused): no runner will
      // ever poll the flag, so finish the job here. CAS on the same status so a
      // processor that claimed the row a millisecond ago wins instead, and stops
      // cooperatively at its first checkpoint.
      const { data: rested } = await admin
        .from("template_generations")
        .update({
          status: "cancelled",
          control: null,
          paused_at: null,
          error: null,
          // Nothing may point at build output this cancel is about to delete.
          zip_path: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("status", flagged.status as string)
        .select("id")
        .maybeSingle();
      if (rested) {
        // No runner will ever unwind for this one, so the route owns the
        // cleanup. Never throws; a failed delete leaves the run cancelled.
        await removeGenerationArtifacts(admin, id);
        return NextResponse.json({ ok: true, status: "cancelled" }, { status: 200 });
      }
    }
  }

  return NextResponse.json({ ok: true, status: "cancelling", aborted: abortedInProcess }, { status: 202 });
}
