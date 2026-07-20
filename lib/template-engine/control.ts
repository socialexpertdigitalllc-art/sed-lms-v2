// Run control for template generations (pause / resume / stop).
//
// Stop means stop: an in-flight AI call is ABORTED, not waited out. Three paths
// deliver that, strongest first:
//   1. the in-process abort registry (abortRegistry.ts) — the pause/cancel route
//      aborts the runner's controller directly, in milliseconds;
//   2. `startControlWatcher` below — a ~1.5s poll of `template_generations.
//      control`, for when the request and the runner are not in one process;
//   3. the runner's `readControl` checkpoints — the original cooperative net,
//      kept because it costs nothing and catches a halt between operations.
// All three converge on one AbortController per generation.
//
// The price of aborting mid-flight is that a cancel can leave a partial zip or
// partially uploaded site objects, so /cancel deletes them (see cleanup.ts).
// A pause deletes nothing: it must stay resumable.
//
// Everything in this file except `readControl` is pure, so the decision logic
// (which is the part that must never be wrong) is unit-tested without a DB.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GenStep } from "./types";

export type ControlDecision = "continue" | "pause" | "cancel";

/** The two halting decisions, i.e. everything except "continue". */
export type HaltMode = Exclude<ControlDecision, "continue">;

/**
 * Interpret a raw `template_generations.control` value. Anything that is not
 * exactly 'pause' or 'cancel' — null, '', whitespace, a stale value from a
 * future version, a non-string because it came out of DB JSON — means "run
 * normally". Failing OPEN is deliberate: a garbled flag must never silently
 * stop a run the operator is paying for, and the operator can always click
 * again. Case/whitespace tolerant so a hand-edited row still works.
 */
export function interpretControl(flag: unknown): ControlDecision {
  if (typeof flag !== "string") return "continue";
  const v = flag.trim().toLowerCase();
  if (v === "pause") return "pause";
  if (v === "cancel") return "cancel";
  return "continue";
}

/**
 * Read the live control flag for a generation. Deliberately thin (one column,
 * no joins) — it runs at every checkpoint, including once per regenerated file.
 * A read error yields "continue": a transient network blip must not halt a run.
 */
export async function readControl(admin: SupabaseClient, generationId: string): Promise<ControlDecision> {
  const { data, error } = await admin
    .from("template_generations")
    .select("control")
    .eq("id", generationId)
    .maybeSingle();
  if (error || !data) return "continue";
  return interpretControl((data as { control?: unknown }).control);
}

/**
 * How often the DB watcher re-reads the `control` column. It is a one-column,
 * one-row read, so the cost is negligible next to the AI calls it is racing;
 * 1.5s is the worst-case delay for a stop that could NOT be delivered in
 * process (a restarted server, or an API request that landed on another
 * instance). The in-process registry covers the normal case instantly.
 */
export const CONTROL_WATCH_INTERVAL_MS = 1500;

/**
 * Watch a running generation's `control` column and fire `onHalt` the moment it
 * turns into pause/cancel. This is the FALLBACK signalling path — see
 * abortRegistry.ts for the instant one.
 *
 * Returns a stop function that MUST be called in a `finally`. A leaked interval
 * on a long-lived Next.js server polls a finished generation forever, and one
 * per run compounds; that is a real bug, not a tidiness point.
 *
 * `onHalt` fires at most once (the interval clears itself first), read errors
 * are swallowed as "continue" by readControl, and overlapping reads are
 * prevented by an in-flight guard so a slow DB cannot queue up polls.
 */
export function startControlWatcher(
  admin: SupabaseClient,
  generationId: string,
  onHalt: (mode: HaltMode) => void,
  intervalMs: number = CONTROL_WATCH_INTERVAL_MS,
): () => void {
  let stopped = false;
  let inFlight = false;
  const timer = setInterval(() => {
    if (stopped || inFlight) return;
    inFlight = true;
    void readControl(admin, generationId)
      .then((decision) => {
        if (stopped || decision === "continue") return;
        stopped = true;
        clearInterval(timer);
        onHalt(decision);
      })
      .catch(() => {
        /* a blip must not halt a paid run — readControl already fails open */
      })
      .finally(() => {
        inFlight = false;
      });
  }, intervalMs);
  // Never hold the process open just to watch a generation.
  (timer as unknown as { unref?: () => void }).unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/** Statuses a running-ish generation can be paused from. */
export const PAUSABLE_STATUSES = ["queued", "running", "planning", "building"] as const;

/**
 * Statuses a generation can be stopped from. `curating` and `paused` are
 * included because a run resting at a human checkpoint is still a live run the
 * operator may want to abandon; the terminal ones (review / deployed / failed /
 * cancelled) are not — /retry and /takedown own those.
 */
export const CANCELLABLE_STATUSES = [
  "queued", "running", "planning", "building", "curating", "paused",
] as const;

/**
 * Statuses where NO runner is in flight, so nobody would ever poll the control
 * flag — the route has to make the status transition itself or the operator's
 * click would do nothing at all. `queued` is the one that matters: the row is
 * sitting in `template_gen_queue` waiting to be claimed, and if we only wrote
 * the flag, the processor's own guard would skip the row and leave the
 * generation stuck at `queued` forever. `curating` and `paused` are at rest by
 * definition.
 */
export const AT_REST_STATUSES = ["queued", "curating", "paused"] as const;

export function isPausableStatus(status: string): boolean {
  return (PAUSABLE_STATUSES as readonly string[]).includes(status);
}

export function isCancellableStatus(status: string): boolean {
  return (CANCELLABLE_STATUSES as readonly string[]).includes(status);
}

/** True when the route must do the transition itself (no runner will see the flag). */
export function isAtRestStatus(status: string): boolean {
  return (AT_REST_STATUSES as readonly string[]).includes(status);
}

/** Build/deploy-phase step keys — the marker that a run had left the plan phase. */
const BUILD_PHASE_KEYS = new Set(["prepare", "verify", "finalize"]);

function reachedBuildPhase(steps: GenStep[]): boolean {
  return steps.some((s) => BUILD_PHASE_KEYS.has(s.key) || s.key.startsWith("build:"));
}

/**
 * Where a paused generation goes when the operator resumes it, and whether that
 * needs a fresh `template_gen_queue` row. Mirrors /retry's "reuse the expensive
 * plan-phase work when it survived" reasoning, but with one more rung, because
 * pause (unlike failure) can land mid-plan:
 *
 *  - paused inside the BUILD phase -> back to `building` + a `kind:'build'`
 *    queue row. Nothing regenerated so far was persisted (the rebuilt files
 *    live only in the runner's memory), so buildFromSelection re-runs prepare
 *    -> regenerate -> verify from the top. That is why the build checkpoints
 *    are safe: there is no partial artefact to reconcile, only work to redo.
 *  - paused after the plan phase produced a content model AND image slots ->
 *    back to `curating`, no queue row at all: the operator simply presses Build
 *    again, exactly as they would have without the pause.
 *  - anything earlier (no content model, or no slots yet) -> back to `queued`
 *    with a fresh `kind:'plan'` row; the plan phase is not resumable part-way,
 *    so it re-runs whole.
 */
export type ResumeTarget = {
  status: "building" | "curating" | "queued";
  enqueue: "plan" | "build" | null;
};

export function resumeTarget(gen: {
  brief: unknown;
  content_model: unknown;
  image_slots: unknown;
  steps: GenStep[];
}): ResumeTarget {
  const planned = !!gen.brief && !!gen.content_model;
  if (planned && reachedBuildPhase(gen.steps)) return { status: "building", enqueue: "build" };
  const hasSlots = Array.isArray(gen.image_slots) && gen.image_slots.length > 0;
  if (planned && hasSlots) return { status: "curating", enqueue: null };
  return { status: "queued", enqueue: "plan" };
}

/**
 * Should the processor DROP a queue row it just claimed instead of running it?
 * A run can be paused or cancelled while its queue row is still `pending`
 * (nobody is polling the flag yet), and /cancel only deletes pending rows it
 * wins the race for. Without this the processor would happily flip a paused row
 * back to `running` and undo the operator's click.
 */
export function shouldSkipClaimed(status: unknown, control: unknown): boolean {
  if (status === "paused" || status === "cancelled") return true;
  return interpretControl(control) !== "continue";
}

/**
 * Drop a generation's not-yet-claimed queue rows and report whether a runner is
 * currently executing one. Used by /pause and /cancel to decide between "the
 * runner will stop itself" and "nobody is listening, transition it myself".
 *
 * Order matters: deleting `pending` rows first closes the window where the
 * processor could claim one after we looked. If the delete removes nothing and
 * a `processing` row exists, the run is genuinely in flight and the control
 * flag (already written by the caller) is what stops it.
 */
export async function releasePendingQueue(
  admin: SupabaseClient,
  generationId: string,
): Promise<{ runnerInFlight: boolean }> {
  await admin.from("template_gen_queue").delete().eq("generation_id", generationId).eq("status", "pending");
  const { data } = await admin
    .from("template_gen_queue")
    .select("id")
    .eq("generation_id", generationId)
    .eq("status", "processing")
    .limit(1);
  return { runnerInFlight: Array.isArray(data) && data.length > 0 };
}
