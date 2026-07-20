// Per-step redo for a template generation — re-run ONE step of a finished (or
// halted) run without cascading into the steps after it.
//
// The product decision this file encodes: a redo is SURGICAL. Re-planning the
// copy does not re-gather images, and re-gathering images does not rebuild the
// site. The operator asked for exactly one thing to change, so exactly one
// thing changes.
//
// The obvious hazard of that choice is silent inconsistency: fresh copy sitting
// next to images that were chosen for the OLD copy, or a built site that
// predates both. Rather than force a cascade (which throws away curation work
// the operator may be perfectly happy with), the later steps are marked STALE —
// visibly, with a one-click "redo this too". Visibility instead of enforcement.
//
// Everything here is pure so the two things that must never be wrong — which
// statuses a redo is legal from, and what a redo invalidates — are unit-tested
// without a database.

import type { GenStep } from "./types";

/** The three steps an operator may re-run on their own. */
export type RedoStepKey = "content" | "images" | "build";

/** The `template_gen_queue.kind` a redo enqueues (migration 0045 widens the CHECK). */
export type RedoQueueKind = "content" | "images" | "build";

export interface RedoSpec {
  key: RedoStepKey;
  /** Button/label text — "Redo <label>". */
  label: string;
  /** One line explaining what re-running actually does, for the UI. */
  summary: string;
  /**
   * Generation statuses this redo may be triggered from. All of them are
   * AT REST: a redo re-enters the pipeline, so a run that is still executing
   * must be paused (or allowed to finish) first — see `isRedoBlockedByRun`.
   */
  allowedFrom: readonly string[];
  /** Later steps whose output predates this one once it re-runs. */
  invalidates: readonly RedoStepKey[];
  /** Queue row kind the redo route inserts. */
  queueKind: RedoQueueKind;
  /** Status the generation is parked at while the redo is queued/running. */
  nextStatus: "queued" | "building";
  /**
   * True when re-running destroys operator input that cannot be recovered
   * (see `describeImagesRedoLoss`). The route refuses these without an
   * explicit `confirm: true` in the request body.
   */
  destructive: boolean;
  /** `steps[]` entries this redo resets before it re-runs. */
  resetStepKeys: readonly string[];
}

/**
 * Statuses shared by content + images. All at rest:
 *  - `curating` — the normal home of a planned-but-unbuilt run.
 *  - `review`   — built; redoing content/images leaves the built site in place
 *                 (it just becomes stale) so the operator can compare.
 *  - `failed` / `cancelled` — a dead run whose artefacts survive.
 *  - `paused`   — a halted run. Redo is a deliberate alternative to Resume.
 * `deployed` is deliberately absent: that site is live, and a redo that quietly
 * desynced a live site from its generation row would be the worst kind of
 * surprise. `queued` is absent because a queue row is already waiting to run.
 */
const PLAN_PHASE_REDO_STATUSES = ["curating", "review", "failed", "cancelled", "paused"] as const;

/**
 * The redo table. Order is pipeline order, which is also the order
 * `invalidates` flows in: content -> images -> build.
 */
export const REDOABLE_STEPS: readonly RedoSpec[] = [
  {
    key: "content",
    label: "content",
    summary:
      "Re-plans the copy from the brief, replacing any edits you made on this screen. Your images and the built site are left exactly as they are.",
    allowedFrom: PLAN_PHASE_REDO_STATUSES,
    invalidates: ["images", "build"],
    queueKind: "content",
    nextStatus: "queued",
    destructive: false,
    // `curate` is re-added when the phase finishes, so it must not be left
    // behind as a duplicate key (the tracker matches steps by key).
    resetStepKeys: ["plan", "curate"],
  },
  {
    key: "images",
    label: "images",
    summary: "Gathers fresh candidates for every slot. The content model and the built site are untouched.",
    allowedFrom: PLAN_PHASE_REDO_STATUSES,
    invalidates: ["build"],
    queueKind: "images",
    nextStatus: "queued",
    // Re-gathering REPLACES `image_slots` wholesale: every candidate, every
    // selection and every custom URL the operator added is gone.
    destructive: true,
    resetStepKeys: ["images", "curate"],
  },
  {
    key: "build",
    label: "build",
    // A rebuild reads `content_model` and `image_slots` and writes only the
    // regenerated files — the operator's content edits are inputs, not outputs.
    summary: "Re-runs the build from prepare. Your content edits and image picks are the input, so nothing you typed is lost.",
    // A build redo only makes sense once a build has been attempted. A run
    // paused mid-build has Resume, which already re-runs the build from prepare.
    allowedFrom: ["review", "failed", "cancelled"],
    invalidates: [],
    queueKind: "build",
    nextStatus: "building",
    destructive: false,
    // Build-phase entries are pruned by rule, not by name (see isBuildPhaseStepKey).
    resetStepKeys: [],
  },
] as const;

/** Canonical order for any set of redo steps. */
export const REDO_STEP_ORDER: readonly RedoStepKey[] = REDOABLE_STEPS.map((s) => s.key);

export function isRedoStepKey(v: unknown): v is RedoStepKey {
  return typeof v === "string" && (REDO_STEP_ORDER as readonly string[]).includes(v);
}

export function redoSpec(key: string): RedoSpec | undefined {
  return REDOABLE_STEPS.find((s) => s.key === key);
}

/** Is this redo legal from that status? Unknown steps are never legal. */
export function canRedoFrom(step: string, status: string): boolean {
  const spec = redoSpec(step);
  return !!spec && spec.allowedFrom.includes(status);
}

/**
 * Statuses where a runner is genuinely executing. Redo is for a run AT REST —
 * re-entering the pipeline underneath a live run would race the runner's own
 * write-through of `steps`/`status`. The route turns this into a "pause it
 * first" message rather than a bare "not allowed".
 */
export const RUN_IN_FLIGHT_STATUSES = ["running", "planning", "building"] as const;

export function isRedoBlockedByRun(status: string): boolean {
  return (RUN_IN_FLIGHT_STATUSES as readonly string[]).includes(status);
}

/** The 409 body message for a redo that is not legal right now. */
export function redoRejectionReason(step: string, status: string): string {
  const spec = redoSpec(step);
  if (!spec) return `Unknown step "${step}"`;
  if (isRedoBlockedByRun(status)) {
    return `This run is ${status} — pause it first, then redo the ${spec.label} step.`;
  }
  return `The ${spec.label} step cannot be redone while the run is ${status}.`;
}

// --- staleness -------------------------------------------------------------
//
// Recorded in `template_generations.stale_steps text[]` (migration 0045) rather
// than inside the existing `steps` jsonb, because:
//  - `steps` is keyed by PIPELINE step (`plan`, `images`, `build:index.html`,
//    `verify`, `finalize`), not by the three operator-facing redo steps; one
//    stale "build" would have to be smeared across a dozen entries.
//  - every redo (and every rebuild) RESETS the very entries a marker would live
//    in — `pruneBuildPhaseSteps` already deletes the whole build phase — so the
//    marks would silently evaporate exactly when they matter most.
//  - a nullable text[] with no default reads back as "nothing stale" on every
//    existing row, which is precisely today's behaviour.

/** Defensive read of the column — DB array, shape not guaranteed. */
export function parseStaleSteps(v: unknown): RedoStepKey[] {
  if (!Array.isArray(v)) return [];
  return sortStale(v.filter(isRedoStepKey));
}

function sortStale(keys: RedoStepKey[]): RedoStepKey[] {
  const set = new Set(keys);
  return REDO_STEP_ORDER.filter((k) => set.has(k));
}

/**
 * The new stale set after `redone` has been (re)queued. Adds everything that
 * step invalidates, and REMOVES the redone step's own mark: its output is about
 * to be replaced, so a mark that said "this predates an upstream change" is
 * obsolete either way. Unknown values already in the column are dropped.
 */
export function markStale(current: unknown, redone: RedoStepKey): RedoStepKey[] {
  const next = new Set(parseStaleSteps(current));
  next.delete(redone);
  for (const k of redoSpec(redone)?.invalidates ?? []) next.add(k);
  return sortStale([...next]);
}

/** The new stale set after `completed` re-ran successfully — it is fresh now. */
export function clearStale(current: unknown, completed: RedoStepKey): RedoStepKey[] {
  const next = parseStaleSteps(current).filter((k) => k !== completed);
  return sortStale(next);
}

export function isStale(current: unknown, step: RedoStepKey): boolean {
  return parseStaleSteps(current).includes(step);
}

/** True when two stale sets are the same, so a no-op write can be skipped. */
export function sameStale(a: readonly RedoStepKey[], b: readonly RedoStepKey[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

/** The amber pill's sentence. Plain about the cause, not alarmed about it. */
export function staleNote(step: RedoStepKey): string {
  if (step === "images") return "Out of date — the content was regenerated after these images were gathered.";
  if (step === "build") return "Out of date — the content or images changed after this site was built.";
  return "Out of date — an earlier step was regenerated after this ran.";
}

// --- step-entry resets -----------------------------------------------------

/** Build/deploy-phase step keys — same rule as runnerV2's pruneBuildPhaseSteps. */
export function isBuildPhaseStepKey(key: string): boolean {
  return key === "prepare" || key === "verify" || key === "finalize" || key.startsWith("build:") || key.startsWith("deploy:");
}

/**
 * Drop the `steps[]` entries that belong to the step being redone, and ONLY
 * those — a surgical redo must not erase the timeline of the steps it is
 * deliberately leaving alone. The re-run appends its fresh entries at the end,
 * which keeps the array in chronological order (that is genuinely what
 * happened: the images were gathered before the copy was re-planned).
 */
export function resetStepsForRedo(steps: GenStep[], step: RedoStepKey): GenStep[] {
  if (step === "build") return steps.filter((s) => !isBuildPhaseStepKey(s.key));
  const drop = new Set(redoSpec(step)?.resetStepKeys ?? []);
  return steps.filter((s) => !drop.has(s.key));
}

// --- destructive-redo copy -------------------------------------------------

/** The minimum of an ImageSlot this module needs — keeps it pure and testable. */
export interface SlotLossShape {
  selected: string[];
  candidates: { source?: string }[];
}

/**
 * Exactly what re-gathering images throws away, phrased for a confirm dialog.
 * This is real curation work — hand-picked photos, pasted custom URLs — and the
 * operator must read the number before they lose it.
 */
export function describeImagesRedoLoss(slots: SlotLossShape[]): string {
  const total = slots.length;
  const chosen = slots.filter((s) => s.selected.length > 0).length;
  const custom = slots.reduce(
    (n, s) => n + s.candidates.filter((c) => c.source === "custom").length,
    0,
  );
  const head = `This replaces all candidates and clears your current selections for ${total} slot${total === 1 ? "" : "s"}.`;
  const bits: string[] = [];
  if (chosen > 0) bits.push(`${chosen} slot${chosen === 1 ? " has" : "s have"} a picked image`);
  if (custom > 0) bits.push(`${custom} custom URL${custom === 1 ? "" : "s"} you added`);
  if (bits.length === 0) return `${head} Nothing has been picked yet, so there is nothing to lose.`;
  return `${head} ${bits.join(" and ")} — gone, and there is no undo.`;
}

// --- queue dispatch --------------------------------------------------------

/** Which runner phase a claimed queue row's `kind` should execute. */
export type QueuePhase = "full" | "content" | "images" | "build";

/**
 * Map `template_gen_queue.kind` to a runner phase. Anything unrecognised —
 * including the legacy default 'plan' and a null from a pre-0035 row — runs the
 * full plan phase, which is exactly what those rows have always meant.
 */
export function queuePhaseFor(kind: unknown): QueuePhase {
  if (kind === "build") return "build";
  if (kind === "content") return "content";
  if (kind === "images") return "images";
  return "full";
}
