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
}

export function originalZipPath(runId: string): string { return `${runId}/original.zip`; }
export function resultZipPath(runId: string): string { return `${runId}/result.zip`; }

/** Harvest caps — a small static site fits far under these; blowing past one
 *  means the agent went somewhere it shouldn't. */
export const MAX_CHANGED_FILES = 200;
export const MAX_RESULT_BYTES = 50 * 1024 * 1024; // deploy route's own cap is 60MB
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const TAIL_MAX_CHARS = 2048;
/** Worker → row progress patch cadence; keep well under the 2s dashboard poll
 *  but never write per-chunk. */
export const PROGRESS_THROTTLE_MS = 2500;
/** A `running` run whose row hasn't moved for this long is reclaimable — the
 *  worker died mid-run (box rebooted, process killed). */
export const STALE_RUNNING_MS = 10 * 60_000;
/** Hard wall-clock cap on one agy invocation. */
export const AGY_TIMEOUT_MS = 15 * 60_000;
/** Heartbeat is stale (worker offline) after this. */
export const HEARTBEAT_STALE_MS = 5 * 60_000;
