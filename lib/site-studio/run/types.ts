import type { ContentDoc } from "../schema";
import type { ImageCandidate } from "../assets/types";

export const RUN_STATUSES = ["queued","preparing","reviewing","approved","rendering","ready","failed","cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** The step chain. Each step is short and idempotent; re-running one is safe. */
export const STEP_ORDER = ["prepare","write","render","finalize"] as const;
export type RunStep = (typeof STEP_ORDER)[number];

const TERMINAL: RunStatus[] = ["ready","failed","cancelled"];
export const isTerminal = (s: RunStatus): boolean => TERMINAL.includes(s);

/** A run whose Content Document may still be edited by an operator: at Gate 1
 *  (reviewing) or at Gate 2 (ready). NOT failed/cancelled — those are dead — and
 *  not the machine-owned statuses in between, where a step is mid-flight.
 *
 *  This is deliberately NOT `!isTerminal(s)`: `isTerminal` also excludes
 *  "ready" (a run's normal RESTING state, reached once and never left again
 *  outside deploy bookkeeping), while an edit at Gate 2 must be ALLOWED at
 *  "ready" — that's the whole point of Gate 2. Conflating the two predicates
 *  is exactly the bug this type was added to fix: `content`, `revert`,
 *  `theme`, and `reroll` each refused every edit once a run reached "ready"
 *  because they checked `isTerminal` instead of this. */
export const isEditable = (s: RunStatus): boolean => s === "reviewing" || s === "ready";

/**
 * Which step a run in this status should execute next, or null when done.
 *
 * NAMING NOTE: a status names the step that JUST COMPLETED, not the step
 * about to run — "preparing" means "prepare is done, run write next", not
 * "prepare is currently running". This reads backwards at first glance, but
 * it is the only reading consistent with the chain below: "queued" (nothing
 * done yet) -> prepare -> "preparing" -> write -> [gate 1] -> "approved" ->
 * render -> "rendering" -> finalize -> "ready". There is deliberately no
 * separate status for "render" actively running — render and finalize both
 * execute while the row reads "rendering" (see finalize.ts's own note on why
 * finalize must never trust a prior render's output).
 *
 * GATE 1: 3b inserts a park between "all pages written" and "render". A run
 * whose write phase fully completes moves to "reviewing" (or straight to
 * "approved" when `options.auto` skips the park) instead of the old 3a
 * "writing" status. "writing" is now DEAD — it was only ever assigned at the
 * instant the write phase fully completed, and that instant now produces
 * "reviewing" or "approved" instead; partial writes still leave the row at
 * "preparing" (unchanged from 3a). `nextStep("reviewing")` is `null` BY
 * DESIGN: a gate is not a machine step, and that single `null` is what makes
 * it structurally impossible for the advancer cron (or anything else calling
 * this machine) to blow through a review. Only the explicit approve action
 * (which sets status to "approved") releases the park.
 */
export function nextStep(status: RunStatus): RunStep | null {
  switch (status) {
    case "queued": return "prepare";
    case "preparing": return "write";
    case "approved": return "render";
    case "rendering": return "finalize";
    default: return null; // reviewing (gate) / ready / failed / cancelled
  }
}

/** True while a run sits parked at a gate, waiting on a human action rather
 *  than a machine step. Gate 1 (`reviewing`) is the only such status in 3b. */
export const awaitingGate = (s: RunStatus): boolean => s === "reviewing";

/** The status a run moves to while `step` is running. */
export const RUNNING_STATUS: Record<RunStep, RunStatus> = {
  prepare: "preparing",
  write: "preparing",
  render: "rendering",
  finalize: "rendering",
};

export const canCancel = (s: RunStatus): boolean => !isTerminal(s);

export interface PageWriteState {
  status: "pending" | "written" | "failed";
  attempts: number;
  error?: string;
  model?: string;
}

/** Per-slot image sourcing state, filled once during the write phase and
 *  never re-queried once present (sourcing is idempotent — see engine.ts). */
/** Keyed in `RunSteps.images.slots` by `"${docPageIndex}:${slotId}"` — the
 *  doc-page INDEX (not page_id: stamped fan-out pages share a page_id) plus
 *  the image slot id. imageSource.ts writes these keys, the images route
 *  serves and accepts them, and the cockpit's ImagePicker echoes them back;
 *  all three must agree on this exact shape, and nothing enforces it at the
 *  type level, so it is documented here at the source. */
export interface SlotImageState {
  query: string;
  candidates: ImageCandidate[];
  sourced_at: string;
}

export interface RunSteps {
  prepare?: { at: string; pages: number };
  write?: { pages: Record<string, PageWriteState> };
  images?: { slots: Record<string, SlotImageState> };
  render?: { at: string; files: number };
  finalize?: { at: string; zip_bytes: number };
}

export interface StudioRunRow {
  id: string;
  lead_id: string | null;
  template_id: string;
  template_version: number;
  status: RunStatus;
  options: { page_ids?: string[]; fan_out_services?: boolean; fan_out_areas?: boolean; auto?: boolean };
  content_doc: ContentDoc | null;
  steps: RunSteps;
  client_photos: string[];
  site_slug: string | null;
  zip_path: string | null;
  deployed_url: string | null;
  error: string | null;
  paused: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
