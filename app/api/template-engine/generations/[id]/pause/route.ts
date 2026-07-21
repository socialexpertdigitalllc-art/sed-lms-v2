import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { isPausableStatus, isAtRestStatus, releasePendingQueue, PAUSABLE_STATUSES } from "@/lib/template-engine/control";
import { abortGeneration } from "@/lib/template-engine/abortRegistry";
import { isOrphaned } from "@/lib/template-engine/liveness";
import { forceResolveGeneration } from "@/lib/template-engine/forceResolve";

interface GenRow {
  id: string;
  lead_id: string;
  status: string;
  heartbeat_at?: string | null;
  updated_at?: string | null;
}

// POST /api/template-engine/generations/[id]/pause — stop a running generation
// IMMEDIATELY, keeping everything it has produced.
//
// Two things happen, in this order. First the route writes
// `template_generations.control = 'pause'` — the durable record, which the
// runner's DB watcher (~1.5s) and its checkpoints both read, and which survives
// a process restart. Then it aborts the runner's AbortController through the
// in-process registry, which on this deployment is the same Node process: the
// in-flight AI call rejects in milliseconds rather than running its remaining
// 30-90s. Nothing is deleted — a paused run must stay resumable — so the
// in-flight step's work is simply discarded and re-run on /resume.
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
    // `*` on purpose — see the same select in the /cancel route: naming
    // `heartbeat_at` before migration 0047 is applied would error the select and
    // turn every Pause into a 404.
    .select("*")
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

  // The flag is now durable, so abort the live run. Done AFTER the write so a
  // runner that unwinds instantly still finds `control` set if it re-reads it.
  // False just means no runner for this generation lives in this process; the
  // DB watcher in whichever process owns it picks the flag up within ~1.5s.
  const abortedInProcess = abortGeneration(id, "pause");

  // Nobody is listening to the flag if the run stopped heartbeating — its
  // process was replaced (a deploy restart is routine on shared hosting) and it
  // would otherwise sit "building" forever. Come to rest here instead. A runner
  // aborted in THIS process is alive by definition and unwinds on its own, so
  // that case always takes the cooperative path.
  const dead =
    !abortedInProcess &&
    isOrphaned({ status: gen.status, heartbeatAt: gen.heartbeat_at, updatedAt: gen.updated_at });
  if (dead) {
    const reason =
      "Paused automatically: the run stopped reporting activity (its process was gone), so it could not pause itself.";
    const resolved = await forceResolveGeneration(admin, id, { mode: "pause", from: PAUSABLE_STATUSES, reason });
    if (resolved) return NextResponse.json({ ok: true, status: "paused", forced: true, reason }, { status: 200 });
  }

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

  return NextResponse.json({ ok: true, status: "pausing", aborted: abortedInProcess }, { status: 202 });
}
