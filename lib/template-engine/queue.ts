import { createAdminClient } from "@/lib/supabase/admin";
import { runTemplateGenerationV2, buildFromSelection } from "./runnerV2";
import { shouldSkipClaimed } from "./control";

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
// 'failed'). tge_claim_next() itself is unchanged and returns
// {id, generation_id, enqueued_by} regardless of kind, so we do one cheap
// follow-up select on the claimed row's own id to learn which phase to run —
// simpler than teaching the RPC a new return column.
export async function processTemplateQueue(): Promise<{ processed: number }> {
  const admin = createAdminClient();
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
      const kind = queueRow?.kind === "build" ? "build" : "plan";

      await admin
        .from("template_generations")
        .update({ status: "running", updated_at: new Date().toISOString() })
        .eq("id", row.generation_id);
      // Each phase sets the generation's OWN terminal status: the plan phase
      // pauses at 'curating' (or 'failed'), the build phase reaches 'review'
      // (or 'failed'). Nothing below this line touches template_generations
      // on the success path, so neither terminal status is ever clobbered.
      if (kind === "build") {
        await buildFromSelection(row.generation_id);
      } else {
        await runTemplateGenerationV2(row.generation_id);
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
