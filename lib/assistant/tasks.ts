import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissionMode } from "./actions/permissions";

/**
 * BACKGROUND TASKS — a job too big for one answer ("categorise every lead in
 * the pipeline") keeps going on its own, run after run, with nobody watching,
 * until SED AI says it is done. The row (assistant_tasks, migration 0092) is
 * the task's memory between runs: the goal, how far it got, and the runner's
 * bookkeeping. lib/assistant/taskRunner.ts runs it; this file is the store and
 * the PURE decisions about what happens after each run.
 *
 * Self-sustaining on purpose: nothing depends on a browser being open, and a
 * run that dies with the server (a restart, a deploy) stops sending
 * heartbeats, so the next sweep runs the task again. It still always ends: it
 * stops itself when done, when it needs the person, when it keeps erroring,
 * when it stops changing anything, or at its run limit.
 */

export type TaskStatus = "running" | "done" | "blocked" | "stopped" | "failed";

export interface AssistantTask {
  id: string;
  user_id: string;
  conversation_id: string;
  goal: string;
  progress: string;
  status: TaskStatus;
  permission_mode: PermissionMode | null;
  runs: number;
  max_runs: number;
  idle_runs: number;
  failures: number;
  changes: number;
  next_run_at: string;
  claim_id: string | null;
  heartbeat_at: string | null;
  last_run_at: string | null;
  last_error: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

/** What the chat shows about a task (never the runner's claim). */
export type TaskView = Pick<
  AssistantTask,
  "id" | "goal" | "progress" | "status" | "runs" | "max_runs" | "changes" | "next_run_at" | "last_run_at" | "last_error" | "finished_at" | "created_at" | "updated_at"
> & { working: boolean };

/** Runs before a task stops itself (a guard against a runaway, not a work limit). */
export const TASK_MAX_RUNS = 40;
/** The pause between one run and the next. */
export const TASK_GAP_MS = 15_000;
/** The person is mid-answer in that chat: try again this much later. */
export const TASK_BUSY_RETRY_MS = 45_000;
/** A run sends a heartbeat this often… */
export const TASK_HEARTBEAT_MS = 30_000;
/** …and one silent this long died with the server: run the task again. */
export const TASK_STALE_MS = 3 * 60_000;
/** One run's ceiling (60 rounds of lookups and bulk changes fits easily). */
export const TASK_RUN_TIMEOUT_MS = 20 * 60_000;
/** Runs in a row that changed nothing before it stops (finished or stuck). */
export const TASK_MAX_IDLE_RUNS = 2;
/** Runs in a row that errored before it gives up. */
export const TASK_MAX_FAILURES = 3;

const GOAL_MAX = 4000;
const PROGRESS_MAX = 4000;
const COLUMNS =
  "id, user_id, conversation_id, goal, progress, status, permission_mode, runs, max_runs, idle_runs, failures, changes, next_run_at, claim_id, heartbeat_at, last_run_at, last_error, finished_at, created_at, updated_at";

export function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** A task as the chat shows it. `working` = a run is going right now. PURE. */
export function taskView(t: AssistantTask, now = Date.now()): TaskView {
  const working = t.status === "running" && Boolean(t.claim_id && t.heartbeat_at && now - Date.parse(t.heartbeat_at) < TASK_STALE_MS);
  return {
    id: t.id,
    goal: t.goal,
    progress: t.progress,
    status: t.status,
    runs: t.runs,
    max_runs: t.max_runs,
    changes: t.changes,
    next_run_at: t.next_run_at,
    last_run_at: t.last_run_at,
    last_error: t.last_error,
    finished_at: t.finished_at,
    created_at: t.created_at,
    updated_at: t.updated_at,
    working,
  };
}

/**
 * What the task is for, when SED AI didn't say it in its own words: the
 * person's message — and when that is only "continue", the messages before it
 * too (newest last), so the goal still says what the job is. PURE; tested.
 */
export function goalFrom(text: string, earlier: string[]): string {
  const now = text.trim();
  const vague = now.length < 80 && /^(ok(ay)?|yes|go( on| ahead)?|continue|carry on|keep going|proceed|do it|start|resume)\b/i.test(now);
  if (!vague || !earlier.length) return clip(now || earlier[earlier.length - 1] || "Carry on with the task.", GOAL_MAX);
  const recent = earlier.slice(-3).map((t) => t.trim()).filter(Boolean);
  return clip([...recent, now].join("\n\n"), GOAL_MAX);
}

/* ---------------------------------------------------------------- store */

/** The chat's live task (status running), or null — also before migration 0092. */
export async function runningTask(admin: SupabaseClient, conversationId: string): Promise<AssistantTask | null> {
  const { data, error } = await admin.from("assistant_tasks").select(COLUMNS).eq("conversation_id", conversationId).eq("status", "running").maybeSingle();
  if (error) return null;
  return (data as AssistantTask | null) ?? null;
}

/** The chat's latest task, whatever its state (the chat's banner). */
export async function latestTask(admin: SupabaseClient, userId: string, conversationId: string): Promise<AssistantTask | null> {
  const { data, error } = await admin
    .from("assistant_tasks")
    .select(COLUMNS)
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as AssistantTask | null) ?? null;
}

export async function getTask(admin: SupabaseClient, id: string): Promise<AssistantTask | null> {
  const { data, error } = await admin.from("assistant_tasks").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AssistantTask | null) ?? null;
}

export class TaskStoreError extends Error {}

/**
 * Start the chat's background task — or, when one is already running there,
 * hand that one back (one live task per chat). The first run is due at once;
 * the runner waits while the answer that started it is still going.
 */
export async function startTask(
  admin: SupabaseClient,
  t: { userId: string; conversationId: string; goal: string; progress?: string; permissionMode: PermissionMode | null },
): Promise<{ task: AssistantTask; created: boolean }> {
  const existing = await runningTask(admin, t.conversationId);
  if (existing) return { task: existing, created: false };
  const { data, error } = await admin
    .from("assistant_tasks")
    .insert({
      user_id: t.userId,
      conversation_id: t.conversationId,
      goal: clip(t.goal, GOAL_MAX) || "Carry on with the task.",
      progress: clip(t.progress ?? "", PROGRESS_MAX),
      permission_mode: t.permissionMode,
      max_runs: TASK_MAX_RUNS,
    })
    .select(COLUMNS)
    .single();
  if (error) {
    // Two answers raced to start one: the other one won.
    const raced = await runningTask(admin, t.conversationId);
    if (raced) return { task: raced, created: false };
    throw new TaskStoreError(error.message);
  }
  return { task: data as AssistantTask, created: true };
}

/** SED AI's own report on the task (update_task_progress). */
export async function reportTask(
  admin: SupabaseClient,
  id: string,
  r: { progress: string; status: "working" | "done" | "blocked" | "stopped" },
  now = new Date(),
): Promise<AssistantTask | null> {
  const iso = now.toISOString();
  const patch: Partial<AssistantTask> =
    r.status === "working"
      ? { progress: clip(r.progress, PROGRESS_MAX), updated_at: iso }
      : { progress: clip(r.progress, PROGRESS_MAX), status: r.status, finished_at: iso, updated_at: iso, last_error: null };
  const { data, error } = await admin.from("assistant_tasks").update(patch).eq("id", id).eq("status", "running").select(COLUMNS).maybeSingle();
  if (error) throw new TaskStoreError(error.message);
  return (data as AssistantTask | null) ?? null;
}

/** The person pressed Stop. */
export async function stopTask(admin: SupabaseClient, userId: string, id: string, now = new Date()): Promise<AssistantTask | null> {
  const iso = now.toISOString();
  const { data, error } = await admin
    .from("assistant_tasks")
    .update({ status: "stopped", finished_at: iso, updated_at: iso, last_error: "Stopped by you." })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("status", "running")
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw new TaskStoreError(error.message);
  return (data as AssistantTask | null) ?? null;
}

/* ------------------------------------------------------ after each run */

/** How one run went, as the runner saw it. */
export interface RunReport {
  /** answered: SED AI finished its answer · budget: the run's budget ran out
   *  · timeout · stopped: aborted · error: the run crashed or the model failed */
  ended: "answered" | "budget" | "timeout" | "stopped" | "error";
  /** Changes that really happened in this run. */
  changes: number;
  /** SED AI called update_task_progress during the run. */
  progressSet: boolean;
  /** The run's final words, kept as progress when it didn't report any. */
  finalText: string | null;
  error?: string | null;
}

export type RunVerdict = { patch: Partial<AssistantTask>; finished: TaskStatus | null };

/**
 * PURE: what happens to the task after a run. `task` is the row as it is NOW
 * (SED AI may have marked it done or blocked during the run; the person may
 * have stopped it). Tested.
 */
export function afterRun(task: AssistantTask, r: RunReport, now: Date): RunVerdict {
  const iso = now.toISOString();
  const base: Partial<AssistantTask> = {
    runs: task.runs + 1,
    changes: task.changes + Math.max(0, r.changes),
    last_run_at: iso,
    claim_id: null,
    heartbeat_at: null,
    updated_at: iso,
  };
  // Finished during the run (SED AI said done/blocked, or the person stopped it).
  if (task.status !== "running") return { patch: base, finished: null };

  const progress = !r.progressSet && r.finalText?.trim() ? { progress: clip(r.finalText, PROGRESS_MAX) } : {};
  const end = (status: TaskStatus, why: string | null): RunVerdict => ({
    patch: { ...base, ...progress, status, finished_at: iso, last_error: why },
    finished: status,
  });

  if (r.ended === "stopped") return end("stopped", "Stopped.");
  if (r.ended === "error") {
    const failures = task.failures + 1;
    if (failures >= TASK_MAX_FAILURES) return end("failed", r.error ?? "It kept running into errors.");
    // Back off a little more after each failure.
    return { patch: { ...base, failures, last_error: r.error ?? null, next_run_at: new Date(now.getTime() + failures * 2 * 60_000).toISOString() }, finished: null };
  }
  const idle = r.changes > 0 ? 0 : task.idle_runs + 1;
  if (idle >= TASK_MAX_IDLE_RUNS) {
    return end("stopped", `Made no changes in its last ${idle} runs, so it stopped — it looks finished or stuck. Check the latest progress, then ask SED AI to carry on if anything is left.`);
  }
  if (task.runs + 1 >= task.max_runs) {
    return end("stopped", `Reached its limit of ${task.max_runs} runs. Ask SED AI to carry on if anything is left.`);
  }
  return {
    patch: { ...base, ...progress, idle_runs: idle, failures: 0, last_error: null, next_run_at: new Date(now.getTime() + TASK_GAP_MS).toISOString() },
    finished: null,
  };
}

/** The message a background run starts with (shown in the chat as a divider, not a bubble). PURE. */
export function runMessage(task: Pick<AssistantTask, "goal" | "runs">): string {
  return `[Background task — run ${task.runs + 1}] Carry on with the task: ${clip(task.goal, 600)}`;
}
