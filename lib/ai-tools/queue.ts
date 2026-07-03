import type { WgeSettings } from "./wge-types";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWgeConfig } from "./wge";
import { mapLeadToInput } from "./leadPrefill";
import { runGenerationForLead } from "./run";
import type { ToolId } from "./config";

type LeadRow = Record<string, unknown>;

export const ADVISORY_LOCK_KEY = 8273; // matches wge_claim_next()

export function AI_TOOLS_PERMS_OK(perms: Set<string>): boolean {
  return perms.has("ai_tools.webcraft") || perms.has("ai_tools.deepseek");
}

// Every required variable key must have a non-empty mapped value.
export function isLeadReady(values: Record<string, string>, readyRequired: string[]): boolean {
  return readyRequired.every((k) => (values[k] ?? "").trim() !== "");
}

// Pure decision: should a freshly-created lead be auto-queued?
export function shouldAutoEnqueue(
  settings: WgeSettings,
  values: Record<string, string>,
  state: { hasActive: boolean; hasGeneration: boolean }
): boolean {
  if (!settings.auto_generate) return false;
  if (!settings.auto_engine) return false;
  if (state.hasActive || state.hasGeneration) return false;
  return isLeadReady(values, settings.ready_required);
}

// Fire-and-forget kick of the processor (does not await; ignores errors).
export function kickProcessor(): void {
  const origin = process.env.WGE_SELF_ORIGIN || "http://localhost:3000";
  const secret = process.env.WGE_PROCESSOR_SECRET || "";
  void fetch(`${origin}/api/ai-tools/wge/process`, {
    method: "POST",
    headers: { "x-wge-secret": secret },
  }).catch(() => {});
}

async function leadHasActiveOrGeneration(admin: ReturnType<typeof createAdminClient>, leadId: string) {
  const { count: activeCount } = await admin
    .from("wge_queue")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", leadId)
    .in("status", ["pending", "processing"]);
  const { count: genCount } = await admin
    .from("ai_generations")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", leadId);
  return { hasActive: (activeCount ?? 0) > 0, hasGeneration: (genCount ?? 0) > 0 };
}

// Called after a lead is created. Never throws (must not block lead creation).
export async function enqueueLeadIfReady(lead: LeadRow, userId: string): Promise<void> {
  try {
    const config = await getWgeConfig();
    if (!config.settings.auto_generate || !config.settings.auto_engine) return;
    const admin = createAdminClient();
    const state = await leadHasActiveOrGeneration(admin, lead.id as string);
    const values = mapLeadToInput(lead, config.variables) as Record<string, string>;
    if (!shouldAutoEnqueue(config.settings, values, state)) return;
    await admin.from("wge_queue").insert({
      lead_id: lead.id as string,
      tool: config.settings.auto_engine.provider,
      model: config.settings.auto_engine.model,
      enqueued_by: userId,
    });
    kickProcessor();
  } catch {
    /* never block lead creation */
  }
}

// Manual "Queue for generation". Returns a reason string on refusal, null on success.
export async function enqueueManual(leadId: string, userId: string): Promise<string | null> {
  const config = await getWgeConfig();
  if (!config.settings.auto_engine) return "Set an auto engine in WGE → Engine Settings first.";
  const admin = createAdminClient();
  const state = await leadHasActiveOrGeneration(admin, leadId);
  if (state.hasActive) return "This lead is already queued.";
  const { error } = await admin.from("wge_queue").insert({
    lead_id: leadId,
    tool: config.settings.auto_engine.provider,
    model: config.settings.auto_engine.model,
    enqueued_by: userId,
  });
  if (error) return error.message;
  kickProcessor();
  return null;
}

// Drain the queue serially. Safe to call concurrently — wge_claim_next() only
// hands out a row when nothing is processing, so at most one generation runs.
export async function processQueue(): Promise<{ processed: number }> {
  const admin = createAdminClient();
  await admin.rpc("wge_reclaim_stale");

  let processed = 0;
  // Bounded loop guard against pathological runaway.
  for (let i = 0; i < 100; i++) {
    const { data: claimed, error } = await admin.rpc("wge_claim_next");
    if (error) break;
    const row = Array.isArray(claimed) ? claimed[0] : claimed;
    if (!row) break; // queue empty OR another generation is in flight

    try {
      const { generationId } = await runGenerationForLead(
        row.lead_id,
        { tool: row.tool as ToolId, model: row.model },
        row.enqueued_by
      );
      await admin
        .from("wge_queue")
        .update({ status: "done", generation_id: generationId, finished_at: new Date().toISOString() })
        .eq("id", row.id);
    } catch (e) {
      await admin
        .from("wge_queue")
        .update({ status: "failed", error: String((e as Error).message).slice(0, 500), finished_at: new Date().toISOString() })
        .eq("id", row.id);
    }
    processed++;
  }
  return { processed };
}
