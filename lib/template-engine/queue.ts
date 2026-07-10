import { createAdminClient } from "@/lib/supabase/admin";
import { runTemplateGeneration } from "./runner";

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
      await admin
        .from("template_generations")
        .update({ status: "running", updated_at: new Date().toISOString() })
        .eq("id", row.generation_id);
      // The runner sets the generation's terminal status (ready_for_review / failed).
      await runTemplateGeneration(row.generation_id);
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
