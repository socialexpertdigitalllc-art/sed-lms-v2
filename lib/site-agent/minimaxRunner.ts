// lib/site-agent/minimaxRunner.ts
/**
 * Where MiniMax runs execute: on the LMS server itself, never the office
 * worker box. SERVER ONLY.
 *
 * A MiniMax run is CREATED already claimed — status "running" with a fresh
 * claim_id — and started right after the response (`after()` in the create and
 * revise routes). It is never "queued", because the office worker claims any
 * queued run, and a worker that predates MiniMax would run it on Antigravity.
 * The worker only reclaims a "running" run after STALE_RUNNING_MS (20 min)
 * without a keepalive; this server's own sweep reclaims a MiniMax run long
 * before that (MINIMAX_STALE_MS), e.g. after a restart cut one short.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notifications/notify";
import { providerSpecFor } from "@/lib/ai-tools/providers/config";
import { createMinimaxDriver } from "./minimax";
import { DEFAULT_MINIMAX_MODEL, isMinimaxModel, runEngine, type AgentDefaults } from "./options";
import { processClaimedRun, type WorkerDeps, type WorkerOutcome } from "./worker";
import { fsWorkspace } from "./workspaceFs";
import type { AgentRunRow } from "./types";

/** The keepalive moves a live run every 30s; three quiet minutes means the
 *  server that ran it is gone. Well under the office worker's 20 minutes. */
export const MINIMAX_STALE_MS = 3 * 60_000;

function minimaxDeps(admin: SupabaseClient): WorkerDeps {
  return {
    admin,
    driver: createMinimaxDriver(),
    workspace: fsWorkspace,
    notify,
    listModels: async () => [],
    engine: "minimax",
  };
}

/** The fields a create/revise writes so the run starts claimed by this server. */
export function minimaxClaim(): { status: "running"; claim_id: string } {
  return { status: "running", claim_id: crypto.randomUUID() };
}

/** Run a MiniMax run this server just claimed. Never throws — the run row
 *  carries any failure. */
export async function runClaimedMinimax(runId: string, claimId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("site_agent_runs").select("*").eq("id", runId).eq("claim_id", claimId).maybeSingle();
    if (!data) return; // discarded (or reclaimed) before it started
    await processClaimedRun(minimaxDeps(admin), data as AgentRunRow, claimId);
  } catch (e) {
    console.error(`[site-agent] MiniMax run ${runId} crashed:`, e instanceof Error ? e.message : e);
  }
}

/**
 * Recovery: picks up ONE MiniMax run that is queued, or "running" with a dead
 * keepalive, and runs it to the end. Called by the server's poller
 * (/api/site-agent/minimax/process).
 */
export async function sweepMinimaxRuns(admin: SupabaseClient = createAdminClient(), nowMs = Date.now()): Promise<WorkerOutcome> {
  const { data: rows, error } = await admin
    .from("site_agent_runs")
    .select("id, status, updated_at, created_at, options")
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: true })
    .limit(50);
  if (error || !rows?.length) return { picked: false };
  const candidate = (rows as Pick<AgentRunRow, "id" | "status" | "updated_at" | "created_at" | "options">[]).find(
    (r) =>
      runEngine(r.options) === "minimax" &&
      (r.status === "queued" || (r.status === "running" && nowMs - new Date(r.updated_at).getTime() > MINIMAX_STALE_MS)),
  );
  if (!candidate) return { picked: false };
  const claimId = crypto.randomUUID();
  const { data: claimed } = await admin
    .from("site_agent_runs")
    .update({ status: "running", claim_id: claimId, error: null, updated_at: new Date(nowMs).toISOString() })
    .eq("id", candidate.id)
    .eq("status", candidate.status)
    .eq("updated_at", candidate.updated_at)
    .select()
    .single();
  if (!claimed) return { picked: false };
  return processClaimedRun(minimaxDeps(admin), claimed as AgentRunRow, claimId);
}

/**
 * The MiniMax model a send uses: the one asked for, else the team's MiniMax
 * default, else M3 — and MiniMax must be set up to take it.
 */
export async function resolveMinimaxChoice(
  raw: unknown,
  defaults: AgentDefaults,
): Promise<{ ok: true; model: string } | { ok: false; message: string }> {
  const asked = typeof raw === "string" && raw.trim() ? raw.trim() : null;
  if (asked && !isMinimaxModel(asked)) return { ok: false, message: `Unknown MiniMax model "${asked}" — pick one from the list.` };
  const model = asked ?? (isMinimaxModel(defaults.minimax_model) ? defaults.minimax_model : DEFAULT_MINIMAX_MODEL);
  const spec = await providerSpecFor("minimax", model);
  if (!spec.spec) {
    return { ok: false, message: `MiniMax isn't ready (${spec.reason}). Add or enable the MiniMax API key under Admin → AI providers.` };
  }
  return { ok: true, model };
}

/** Whether MiniMax can take a run right now — for the panel. No secrets. */
export async function minimaxAvailability(): Promise<{ available: boolean; reason: string | null }> {
  const spec = await providerSpecFor("minimax", DEFAULT_MINIMAX_MODEL).catch(() => ({ spec: null, reason: "could not read the AI provider settings" }));
  return spec.spec ? { available: true, reason: null } : { available: false, reason: spec.reason };
}
