import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { isPausableStatus, isAtRestStatus, releasePendingQueue, PAUSABLE_STATUSES } from "@/lib/template-engine/control";

interface GenRow {
  id: string;
  lead_id: string;
  status: string;
}

// POST /api/template-engine/generations/[id]/pause — ask a running generation to
// stop at its next safe checkpoint, keeping everything it has produced.
//
// The route never touches the running task; it writes
// `template_generations.control = 'pause'` and the runner polls that flag
// between pipeline steps, between per-file regenerations and between repair
// rounds (see lib/template-engine/runnerV2.ts). Killing the task outright would
// risk a half-written zip or an orphaned storage folder.
//
// One case has no runner to poll: a generation still `queued`. Its row is
// sitting in `template_gen_queue` waiting to be claimed, so this route deletes
// that pending row and makes the `paused` transition itself.
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

  // RLS-scoped lookup: a lead this user cannot see must 404, not pause.
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", gen.lead_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  if (!isPausableStatus(gen.status)) {
    return NextResponse.json({ error: "Only a running generation can be paused" }, { status: 409 });
  }

  // CAS on the whole running-ish status set so a run that finished (or failed)
  // between the read above and this write is never flagged.
  const { data: flagged, error } = await admin
    .from("template_generations")
    .update({ control: "pause", updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", PAUSABLE_STATUSES as unknown as string[])
    .select("id, status")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!flagged) return NextResponse.json({ error: "Only a running generation can be paused" }, { status: 409 });

  if (isAtRestStatus(flagged.status as string)) {
    const { runnerInFlight } = await releasePendingQueue(admin, id);
    if (!runnerInFlight) {
      // Nobody will ever read the flag — come to rest here instead. CAS on the
      // same status so a processor that claimed the row a millisecond ago wins
      // and stops cooperatively at its first checkpoint rather than being
      // overwritten mid-run.
      const { data: rested } = await admin
        .from("template_generations")
        .update({
          status: "paused",
          control: null,
          paused_at: new Date().toISOString(),
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("status", flagged.status as string)
        .select("id")
        .maybeSingle();
      if (rested) return NextResponse.json({ ok: true, status: "paused" }, { status: 200 });
    }
  }

  return NextResponse.json({ ok: true, status: "pausing" }, { status: 202 });
}
