// lib/site-agent/types.ts
/**
 * Ticket Agent — shared vocabulary between the prod routes and the Windows-box
 * worker. Everything here must stay tiny and serialization-safe: `files` and
 * `usage` land in jsonb columns that are polled every 2s while a run is
 * active, and the 2026-08-17 disk-IO incident is why NO file contents ever
 * ride in these types — contents live in the agent-sites bucket.
 */

export const AGENT_SITES_BUCKET = "agent-sites";

export type AgentRunStatus =
  | "queued" | "running" | "review" | "deploying" | "deployed" | "failed" | "discarded";

/** Must match the partial unique index in 0071 — one in-flight run per ticket. */
export const AGENT_RUN_ACTIVE_STATUSES = ["queued", "running", "review", "deploying"] as const;
export function isActiveStatus(s: string): boolean {
  return (AGENT_RUN_ACTIVE_STATUSES as readonly string[]).includes(s);
}

export interface AgentFileChange {
  action: "edit" | "create" | "delete";
  bytes: number;
}

export interface AgentRunRow {
  id: string;
  ticket_id: string | null;
  lead_id: string | null;
  site_host: string;
  status: AgentRunStatus;
  claim_id: string | null;
  conversation_id: string | null;
  instructions: string | null;
  files: Record<string, AgentFileChange>;
  output_tail: string | null;
  summary: string | null;
  usage: Record<string, number> | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  item_ids: string[] | null;
  task_text: string | null;
  model: string | null;
}

/** A single agy-published model choice (`agy models` TSV: id\tlabel). */
export interface AgyModel { id: string; label: string }

export function originalZipPath(runId: string): string { return `${runId}/original.zip`; }
export function resultZipPath(runId: string): string { return `${runId}/result.zip`; }

/** Harvest caps — a small static site fits far under these; blowing past one
 *  means the agent went somewhere it shouldn't. */
export const MAX_CHANGED_FILES = 200;
export const MAX_RESULT_BYTES = 50 * 1024 * 1024; // deploy route's own cap is 60MB
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** v2 F6: real agent text (not just step labels) streams into the tail now,
 *  so it needs real room — 2048 was step-label-sized. */
export const TAIL_MAX_CHARS = 6000;
/** v2 F2: worker's `agy models` re-fetch cadence — at most this often per poll cycle. */
export const MODELS_REFRESH_MS = 10 * 60_000;
/** Worker → row progress patch cadence; keep well under the 2s dashboard poll
 *  but never write per-chunk. */
export const PROGRESS_THROTTLE_MS = 2500;
/** A `running` run whose row hasn't moved for this long is reclaimable — the
 *  worker died mid-run (box rebooted, process killed). MUST exceed
 *  AGY_TIMEOUT_MS (15m) plus scheduling overhead: a LIVE run may legitimately
 *  go the full agy wall-clock without a terminal write, and it must never
 *  look stale merely because agy is slow. (The keepalive below keeps a live
 *  row far fresher than this in practice; this wall is the backstop.) */
export const STALE_RUNNING_MS = 20 * 60_000;
/** Cadence of the worker's guarded keepalive patch while agy runs — keeps a
 *  live run's updated_at moving (so it can't be reclaimed as stale) and
 *  notices a dashboard discard even when agy emits no events for minutes. */
export const KEEPALIVE_MS = 30_000;
/** Hard wall-clock cap on one agy invocation. */
export const AGY_TIMEOUT_MS = 15 * 60_000;
/** Heartbeat is stale (worker offline) after this. */
export const HEARTBEAT_STALE_MS = 5 * 60_000;
