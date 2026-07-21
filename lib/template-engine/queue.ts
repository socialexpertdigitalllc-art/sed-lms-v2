import { createAdminClient } from "@/lib/supabase/admin";
import { runTemplateGenerationV2, buildFromSelection } from "./runnerV2";
import { shouldSkipClaimed } from "./control";
import { IN_FLIGHT_STATUSES, shouldReclaimQueueRow } from "./liveness";
import { queuePhaseFor } from "./redo";

// Fire-and-forget kick of the template processor (does not await; ignores errors).
// Reuses the WGE self-origin + shared secret env pair.
export function kickTemplateProcessor(): void {
  const origin = process.env.WGE_SELF_ORIGIN || "http://localhost:3000";
  const secret = process.env.WGE_PROCESSOR_SECRET || "";
  void fetch(`${origin}/api/template-engine/process`, {
    method: "POST",
    headers: { "x-wge-secret": secret },
  }).catch(() => {});
}

// Drain the template queue serially. Safe to call concurrently — tge_claim_next()
// only hands out a row when nothing is processing, so at most one run is active.
//
// Each queue row carries a `kind` (migration 0035): 'plan' (default) runs the
// PLAN phase (plan the content model, gather + vision-rank images into
// `image_slots`, then stop at status='curating' for the operator); 'build'
// (queued by the /build API — Task 5 — once the operator has picked images)
// runs the BUILD phase (regenerate -> verify -> finalize -> status='review' /
// 'failed'). 'content' and 'images' (migration 0045, queued by the /redo API)
// re-run ONE step of the plan phase and nothing else.
// tge_claim_next() itself is unchanged and returns
// {id, generation_id, enqueued_by} regardless of kind, so we do one cheap
// follow-up select on the claimed row's own id to learn which phase to run —
// simpler than teaching the RPC a new return column.
/**
 * Free the queue of rows that will never finish.
 *
 * tge_claim_next() hands out NO work while any row is `processing`, so a single
 * run whose process died takes the whole pipeline down with it — that is what
 * turned one ghost generation into a stopped queue in the incident (see
 * liveness.ts). The RPC `tge_reclaim_stale` only helps after 20 minutes, only
 * for generations at `running` (not `building`/`planning`), and it RE-QUEUES the
 * run, which for a build that already burned its AI budget is the wrong answer.
 *
 * This is the sharper version: a `processing` row whose generation has stopped
 * heartbeating (or has been deleted outright) is closed as `failed` and its
 * generation moved to `failed` too, with an error a human can read. Nothing is
 * re-run automatically — /retry exists and is the operator's decision to make.
 *
 * Best-effort throughout: a reclaim that errors must never stop the processor
 * from draining the rest of the queue.
 */
async function reclaimOrphanedQueueRows(admin: ReturnType<typeof createAdminClient>): Promise<void> {
  try {
    const { data: rows } = await admin
      .from("template_gen_queue")
      .select("id, generation_id, status")
      .eq("status", "processing");
    if (!Array.isArray(rows) || rows.length === 0) return;
    const now = Date.now();
    for (const row of rows as { id: string; generation_id: string; status: string }[]) {
      // `*` rather than a column list: `heartbeat_at` only exists once migration
      // 0047 is applied, and naming it would error the select on a database one
      // deploy behind — which would silently disable the whole reclaim.
      const { data: gen } = await admin
        .from("template_generations")
        .select("*")
        .eq("id", row.generation_id)
        .maybeSingle();
      const g = gen as { status?: unknown; heartbeat_at?: unknown; updated_at?: unknown } | null;
      const reclaim = shouldReclaimQueueRow({
        queueStatus: row.status,
        generation: g ? { status: g.status, heartbeatAt: g.heartbeat_at, updatedAt: g.updated_at } : null,
        now,
      });
      if (!reclaim) continue;

      const reason =
        "The run stopped reporting activity — its process was gone (most likely a server restart), so it could never finish or stop itself.";
      await admin
        .from("template_gen_queue")
        .update({ status: "failed", error: reason.slice(0, 500), finished_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "processing");
      if (!g) continue;
      // CAS on the in-flight statuses only: a generation that came back to life
      // between the two reads keeps whatever it wrote for itself.
      await admin
        .from("template_generations")
        .update({ status: "failed", control: null, error: reason, updated_at: new Date().toISOString() })
        .eq("id", row.generation_id)
        .in("status", [...IN_FLIGHT_STATUSES]);
      console.warn(`[template-engine] reclaimed wedged queue row ${row.id} for orphaned generation ${row.generation_id}`);
    }
  } catch {
    // A failed reclaim must not stop the queue from draining.
  }
}

export async function processTemplateQueue(): Promise<{ processed: number }> {
  const admin = createAdminClient();
  // BEFORE claiming: unwedge anything a dead runner left behind, or the claim
  // below returns nothing at all and the queue stays blocked forever.
  await reclaimOrphanedQueueRows(admin);
  await admin.rpc("tge_reclaim_stale");

  let processed = 0;
  // Bounded loop guard against pathological runaway.
  for (let i = 0; i < 100; i++) {
    const { data: claimed, error } = await admin.rpc("tge_claim_next");
    if (error) break;
    const row = Array.isArray(claimed) ? claimed[0] : claimed;
    if (!row) break; // queue empty OR another generation is in flight

    try {
      // Never start (or restart) a run the operator has stopped. A pause/stop
      // can land while the queue row is still `pending` — nobody is polling the
      // control flag at that point — and /cancel only deletes the pending rows
      // it wins the race for. Without this guard the claim below would flip a
      // paused generation straight back to `running`.
      const { data: controlRow } = await admin
        .from("template_generations")
        .select("status, control")
        .eq("id", row.generation_id)
        .maybeSingle();
      if (controlRow && shouldSkipClaimed(controlRow.status, controlRow.control)) {
        await admin
          .from("template_gen_queue")
          .update({ status: "done", finished_at: new Date().toISOString() })
          .eq("id", row.id);
        processed++;
        continue;
      }

      const { data: queueRow } = await admin
        .from("template_gen_queue")
        .select("kind")
        .eq("id", row.id)
        .maybeSingle();
      const phase = queuePhaseFor(queueRow?.kind);

      await admin
        .from("template_generations")
        .update({ status: "running", updated_at: new Date().toISOString() })
        .eq("id", row.generation_id);
      // Each phase sets the generation's OWN terminal status: the plan phase
      // pauses at 'curating' (or 'failed'), the build phase reaches 'review'
      // (or 'failed'). Nothing below this line touches template_generations
      // on the success path, so neither terminal status is ever clobbered.
      if (phase === "build") {
        await buildFromSelection(row.generation_id);
      } else if (phase === "full") {
        await runTemplateGenerationV2(row.generation_id);
      } else {
        // 'content' / 'images' — a per-step redo (migration 0045). Same plan
        // phase, narrowed to the one step the operator asked to re-run.
        await runTemplateGenerationV2(row.generation_id, phase);
      }
      await admin
        .from("template_gen_queue")
        .update({ status: "done", finished_at: new Date().toISOString() })
        .eq("id", row.id);
    } catch (e) {
      const msg = String((e as Error).message ?? e).slice(0, 500);
      await admin
        .from("template_gen_queue")
        .update({ status: "failed", error: msg, finished_at: new Date().toISOString() })
        .eq("id", row.id);
      // Safety net: the runner marks the generation failed before rethrowing,
      // but make sure a crash outside the runner's catch never strands "running".
      await admin
        .from("template_generations")
        .update({ status: "failed", error: msg, updated_at: new Date().toISOString() })
        .eq("id", row.generation_id)
        .eq("status", "running");
    }
    processed++;
  }
  return { processed };
}
