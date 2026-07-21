// Is a generation that CLAIMS to be running actually running?
//
// THE INCIDENT. A generation sat at status='building', current_step='verify',
// control='pause', with a `template_gen_queue` row wedged at 'processing'.
// Nothing was executing it — the runner had been killed by a deploy restart.
// The operator pressed Stop repeatedly and /cancel did exactly what it was
// written to do: it wrote the control flag and left the transition to the live
// runner. There was no live runner. The run stayed "building" forever, the
// queue stayed blocked behind its `processing` row, and the wizard span a
// spinner on a build that had been dead for hours. Deleting the lead did not
// help: the ghost generation outlived it.
//
// Process restarts on shared hosting are routine, so "a runner exists" cannot be
// an assumption. It has to be a MEASUREMENT, which is what this file provides:
// the runner stamps `heartbeat_at` every ~10s while it executes (migration
// 0047), and everything else decides liveness from that stamp.
//
// WHY NOT `updated_at`. Because it is written by everything — every step
// write-through, every control-flag write, the routes themselves. In the
// incident it looked fresh purely because the operator's own Stop clicks kept
// bumping it while the runner was long dead. A liveness signal must have exactly
// one writer, and `heartbeat_at` does: the runner, and nothing else. `updated_at`
// appears below in exactly one role — as the AGE OF THE ROW, used only to decide
// whether a row with no heartbeat at all has been sitting there long enough to
// be declared dead. That is a "how old is this record" question, not a "who
// touched it last" one.
//
// Everything here is pure, so the decision that force-resolves a paid run is
// unit-tested without a database.

/**
 * Statuses that assert "a runner is executing this right now". Only these can be
 * orphaned: `queued`, `curating` and `paused` are at rest BY DESIGN (nobody is
 * meant to be running them), and the terminal ones are done. Declaring any of
 * those orphaned would force-fail runs that are behaving perfectly.
 */
export const IN_FLIGHT_STATUSES = ["running", "planning", "building"] as const;

export function isInFlightStatus(status: unknown): boolean {
  return typeof status === "string" && (IN_FLIGHT_STATUSES as readonly string[]).includes(status);
}

/**
 * How stale a heartbeat may get before the run is presumed dead.
 *
 * The runner stamps every HEARTBEAT_INTERVAL_MS (10s, see control.ts), so a
 * healthy run is at most ~10s stale. The margin on top of that has to absorb
 * three things: the watcher tick jitter, a slow DB write, and — the big one —
 * that the stamp rides the same timer as the control watcher, whose reads can
 * queue behind a busy event loop during a heavy build. 90s is nine missed beats:
 * far beyond anything a live run produces, and still short enough that an
 * operator who clicks Stop on a dead run gets it resolved on that very click
 * rather than being told to come back later. Erring long is the right direction —
 * a false "orphaned" would kill a run that is merely slow, which costs real
 * money; a false "alive" only means the operator presses Force stop.
 */
export const ORPHAN_AFTER_MS = 90_000;

/** Best-effort parse of a timestamptz coming back as an ISO string (or Date, or ms). */
function toMs(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

export interface LivenessInput {
  status: unknown;
  /** `template_generations.heartbeat_at` — written ONLY by the runner. */
  heartbeatAt?: unknown;
  /**
   * `template_generations.updated_at`, used ONLY as the row's age for rows that
   * have no heartbeat at all (pre-0047 rows, or a runner that died before its
   * first stamp). NEVER as the liveness signal — see the file header.
   */
  updatedAt?: unknown;
  now?: number;
}

/**
 * Does this generation claim to be running while nothing is actually running it?
 *
 *  - not an in-flight status            -> false (at rest or finished, by design)
 *  - a heartbeat exists                 -> stale by more than ORPHAN_AFTER_MS
 *  - no heartbeat, but the row is older
 *    than ORPHAN_AFTER_MS               -> true; covers every row written before
 *                                          0047 existed, and the runner that died
 *                                          before its first stamp landed
 *  - no heartbeat and no usable row age -> false; we genuinely cannot tell, and
 *                                          guessing would kill live runs. The
 *                                          operator still has Force stop.
 *
 * A heartbeat in the future (clock skew between the DB and this process) reads
 * as fresh, which is the safe direction.
 */
export function isOrphaned(input: LivenessInput): boolean {
  if (!isInFlightStatus(input.status)) return false;
  const now = input.now ?? Date.now();
  const beat = toMs(input.heartbeatAt);
  if (beat !== null) return now - beat > ORPHAN_AFTER_MS;
  const age = toMs(input.updatedAt);
  if (age === null) return false;
  return now - age > ORPHAN_AFTER_MS;
}

/** Whole minutes a dead run has been silent, for the "no activity for N minutes" copy. */
export function orphanSilenceMinutes(input: Omit<LivenessInput, "status">): number {
  const now = input.now ?? Date.now();
  const since = toMs(input.heartbeatAt) ?? toMs(input.updatedAt);
  if (since === null) return 0;
  return Math.max(1, Math.floor((now - since) / 60_000));
}

/**
 * Should the processor resolve a `template_gen_queue` row instead of leaving it
 * wedged? One dead run's `processing` row blocks the ENTIRE queue, because
 * tge_claim_next() refuses to hand out work while anything is processing — which
 * is why the incident was not one stuck generation but a stopped pipeline.
 *
 * Only `processing` rows are candidates (pending rows are claimed normally, and
 * finished rows are nobody's problem). Two cases resolve:
 *  - the generation row is GONE — nothing will ever finish this row;
 *  - the generation is orphaned by the heartbeat test above.
 * Everything else, including a generation resting at `curating` moments before
 * the processor marks its row done, is left strictly alone: a false reclaim
 * would fail a run that is about to succeed.
 */
export function shouldReclaimQueueRow(input: {
  queueStatus: unknown;
  /** null when the generation row no longer exists. */
  generation: { status: unknown; heartbeatAt?: unknown; updatedAt?: unknown } | null;
  now?: number;
}): boolean {
  if (input.queueStatus !== "processing") return false;
  if (!input.generation) return true;
  return isOrphaned({ ...input.generation, now: input.now });
}
