// lib/site-agent/workerStatus.ts
/**
 * v2 F2 — the panel-facing worker status, shared by the poll route and both
 * run-list routes (ticket + lead): ONE narrow single-row app_settings read
 * (the same read the poll route always did for the heartbeat) yielding the
 * online verdict plus the worker-published model catalogue. `models` is []
 * whenever the column is absent or malformed — the dialog then offers only
 * "Antigravity default". The list itself is agy's own live catalogue,
 * published by the worker box; nothing here is ever hardcoded.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { HEARTBEAT_STALE_MS, type AgyModel } from "./types";

export interface WorkerStatus {
  workerOnline: boolean;
  models: AgyModel[];
}

export async function workerStatus(admin: SupabaseClient): Promise<WorkerStatus> {
  const { data } = await admin
    .from("app_settings")
    .select("agent_worker_seen_at, agent_worker_models")
    .limit(1)
    .maybeSingle();
  const row = data as {
    agent_worker_seen_at?: string | null;
    agent_worker_models?: { models?: unknown } | null;
  } | null;
  const seenAt = row?.agent_worker_seen_at ?? null;
  const workerOnline = seenAt !== null && Date.now() - new Date(seenAt).getTime() < HEARTBEAT_STALE_MS;
  const raw = row?.agent_worker_models?.models;
  const models = Array.isArray(raw)
    ? (raw.filter(
        (m) => !!m && typeof (m as AgyModel).id === "string" && typeof (m as AgyModel).label === "string",
      ) as AgyModel[])
    : [];
  return { workerOnline, models };
}

/**
 * v2 F1 — model intake shared by both create routes. The WORKER is the
 * authority on model ids: when it has published a list, the choice must be
 * on it (422 otherwise); when no list exists yet (the worker never managed
 * an `agy models` run) any sane id is accepted and agy itself refuses a bad
 * one at run time. Empty/whitespace means "Antigravity default" → null.
 */
export async function resolveModelChoice(
  admin: SupabaseClient,
  raw: unknown,
): Promise<{ ok: true; model: string | null } | { ok: false; message: string }> {
  if (raw === undefined || raw === null) return { ok: true, model: null };
  if (typeof raw !== "string") return { ok: false, message: "model must be a string" };
  const model = raw.trim();
  if (!model) return { ok: true, model: null };
  if (model.length > 100) return { ok: false, message: "That model id is too long." };
  const { models } = await workerStatus(admin);
  if (models.length && !models.some((m) => m.id === model)) {
    return { ok: false, message: `Unknown model "${model}" — pick one from the list.` };
  }
  return { ok: true, model };
}
