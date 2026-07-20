import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import {
  isCancellableStatus, isAtRestStatus, releasePendingQueue, CANCELLABLE_STATUSES,
} from "@/lib/template-engine/control";
import { abortGeneration } from "@/lib/template-engine/abortRegistry";
import { removeGenerationArtifacts } from "@/lib/template-engine/cleanup";

interface GenRow {
  id: string;
  lead_id: string;
  status: string;
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
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const admin = createAdminClient();
  const { data: genRow } = await admin
    .from("template_generations")
    .select("id, lead_id, status")
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
