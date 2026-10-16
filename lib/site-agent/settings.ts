// lib/site-agent/settings.ts
/**
 * The AI developer's team defaults (app_settings.agent_defaults) and the
 * per-model timing the settings dialog shows, plus the column-tolerant writes
 * the run routes need while migration 0086 may not be applied yet: without it
 * the dashboard still sends runs, they just carry no options (the worker then
 * uses the built-in defaults).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ttlCached, ttlInvalidate } from "@/lib/cache/ttl";
import { minimaxModels, readDefaults, type AgentDefaults } from "./options";
import type { AgyModel } from "./types";
import { workerStatus } from "./workerStatus";

/** Who may change the team defaults: the board operators and settings admins. */
export const AGENT_SETTINGS_PERMS = ["studio.manage", "admin.settings.manage"] as const;

export function canConfigureAgent(perms: Set<string>): boolean {
  return AGENT_SETTINGS_PERMS.some((p) => perms.has(p));
}

/** A select/insert/update that named a column the database doesn't have yet. */
export function isMissingColumn(error: { code?: string; message?: string } | null | undefined, column: string): boolean {
  if (!error) return false;
  if (error.code === "PGRST204" || error.code === "42703") return (error.message ?? "").includes(column);
  return new RegExp(`column .*${column}.* does not exist|'${column}' column`, "i").test(error.message ?? "");
}

export async function getAgentDefaults(admin: SupabaseClient): Promise<{ defaults: AgentDefaults; available: boolean }> {
  const { data, error } = await admin.from("app_settings").select("agent_defaults").eq("singleton", true).maybeSingle();
  if (error) return { defaults: {}, available: !isMissingColumn(error, "agent_defaults") };
  return { defaults: readDefaults((data as { agent_defaults?: unknown } | null)?.agent_defaults), available: true };
}

export async function saveAgentDefaults(
  admin: SupabaseClient, defaults: AgentDefaults, userId: string,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const { error } = await admin
    .from("app_settings")
    .update({ agent_defaults: defaults, updated_at: new Date().toISOString(), updated_by: userId })
    .eq("singleton", true);
  if (!error) {
    ttlInvalidate("site-agent-stats", "all");
    return { ok: true };
  }
  if (isMissingColumn(error, "agent_defaults")) {
    return {
      ok: false,
      status: 409,
      message: "The database needs update 0086 (AI developer settings) before team defaults can be saved.",
    };
  }
  return { ok: false, status: 500, message: error.message };
}

/** The team's default model, if the worker still offers it. A model that has
 *  been withdrawn (all of Gemini 3.7 was, on 2026-10-13) falls back to
 *  Antigravity's own default rather than failing every run. */
export function defaultModelFrom(defaults: AgentDefaults, models: AgyModel[]): string | null {
  const id = defaults.model ?? null;
  if (!id) return null;
  return !models.length || models.some((m) => m.id === id) ? id : null;
}

/**
 * Inserts a run, with its `options` when the column exists. Before 0086 is
 * applied PostgREST refuses the unknown column (PGRST204); the run is then
 * inserted without options rather than not at all.
 */
export async function insertAgentRun(
  admin: SupabaseClient, row: Record<string, unknown>,
): Promise<{ data: Record<string, unknown> | null; error: { code?: string; message?: string } | null }> {
  const first = await admin.from("site_agent_runs").insert(row).select().single();
  if (!first.error || !("options" in row) || !isMissingColumn(first.error, "options")) {
    return { data: first.data as Record<string, unknown> | null, error: first.error };
  }
  const rest = { ...row };
  delete rest.options;
  const retry = await admin.from("site_agent_runs").insert(rest).select().single();
  return { data: retry.data as Record<string, unknown> | null, error: retry.error };
}

/** One model's recent timing: a ROUND is one send or one "Request changes",
 *  from the click to the result (or failure), queue wait included. */
export interface AgentModelStat {
  /** agy model id; null = Antigravity's default. */
  model: string | null;
  rounds: number;
  failed: number;
  medianMin: number;
}

const STATS_DAYS = 30;
/** A round longer than this sat in the queue with the worker switched off
 *  (one waited overnight on 2026-10-13); it says nothing about the model. */
const ROUND_CAP_MS = 3 * 60 * 60_000;

type LogRow = { action: string; created_at: string; new_value: Record<string, unknown> | null };

/** Pure: pairs each start (created/revised) with the next end (completed/failed). */
export function computeModelStats(logs: LogRow[], runModels: Map<string, string | null>): AgentModelStat[] {
  const byRun = new Map<string, LogRow[]>();
  for (const l of logs) {
    const runId = typeof l.new_value?.run_id === "string" ? l.new_value.run_id : null;
    if (!runId) continue;
    const list = byRun.get(runId) ?? [];
    list.push(l);
    byRun.set(runId, list);
  }
  const rounds = new Map<string, { ms: number[]; failed: number; model: string | null }>();
  for (const [runId, events] of byRun) {
    events.sort((a, b) => a.created_at.localeCompare(b.created_at));
    let start: LogRow | null = null;
    for (const e of events) {
      if (e.action === "site_agent.run.created" || e.action === "site_agent.run.revised") {
        start = e;
        continue;
      }
      if (!start || (e.action !== "site_agent.run.completed" && e.action !== "site_agent.run.failed")) continue;
      const ms = new Date(e.created_at).getTime() - new Date(start.created_at).getTime();
      const sentWith = start.new_value && "model" in start.new_value ? start.new_value.model : undefined;
      const model = typeof sentWith === "string" ? sentWith : sentWith === null ? null : runModels.get(runId) ?? null;
      start = null;
      if (ms <= 0 || ms > ROUND_CAP_MS) continue;
      const key = model ?? "";
      const bucket = rounds.get(key) ?? { ms: [], failed: 0, model };
      bucket.ms.push(ms);
      if (e.action === "site_agent.run.failed") bucket.failed++;
      rounds.set(key, bucket);
    }
  }
  return [...rounds.values()]
    .map(({ ms, failed, model }) => {
      const sorted = [...ms].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      return { model, rounds: ms.length, failed, medianMin: Math.round((median / 60_000) * 10) / 10 };
    })
    .sort((a, b) => b.rounds - a.rounds);
}

/** Per-model timing over the last 30 days, cached for 10 minutes. */
export async function agentModelStats(admin: SupabaseClient): Promise<AgentModelStat[]> {
  return ttlCached("site-agent-stats", "all", 10 * 60_000, async () => {
    const since = new Date(Date.now() - STATS_DAYS * 24 * 60 * 60_000).toISOString();
    const { data: logs, error } = await admin
      .from("activity_log")
      .select("action, created_at, new_value")
      .in("action", ["site_agent.run.created", "site_agent.run.revised", "site_agent.run.completed", "site_agent.run.failed"])
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(5000);
    if (error) throw new Error(error.message);
    const { data: runs } = await admin.from("site_agent_runs").select("id, model").gte("created_at", since).limit(5000);
    const runModels = new Map<string, string | null>(
      ((runs ?? []) as { id: string; model: string | null }[]).map((r) => [r.id, r.model ?? null]),
    );
    return computeModelStats((logs ?? []) as LogRow[], runModels);
  }).catch(() => []);
}

/** Everything the AI developer panel needs besides the runs themselves: the
 *  worker's status and models, the team defaults the send dialog starts from,
 *  recent per-model timing, and whether this viewer may change the defaults. */
export async function agentPanelContext(admin: SupabaseClient, perms: Set<string>) {
  // Lazy: the runner pulls in the AI provider config (server-only secrets).
  const { minimaxAvailability } = await import("./minimaxRunner");
  const [status, settings, stats, minimax] = await Promise.all([
    workerStatus(admin),
    getAgentDefaults(admin),
    agentModelStats(admin),
    minimaxAvailability(),
  ]);
  return {
    workerOnline: status.workerOnline,
    models: status.models,
    defaults: settings.defaults,
    settingsAvailable: settings.available,
    canConfigure: canConfigureAgent(perms),
    stats,
    /** The MiniMax engine: whether its API key is set up, and its models. */
    minimax: { ...minimax, models: minimaxModels() },
  };
}
