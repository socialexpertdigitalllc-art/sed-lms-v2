/**
 * Pure status/step helpers for the 5-step generation wizard (design §10).
 * The generation row is the wizard's single source of truth; everything here
 * derives UI state from `template_generations.status` and friends. No I/O.
 */

import type { ImageSlot } from "./imageSlots";
import type { GenStep } from "./types";

/** Statuses with a finished, downloadable/deployable site zip. "review" is the
 *  v2 terminal build status; "ready_for_review" is v1-legacy (old rows only). */
export const DEPLOYABLE_STATUSES = ["review", "ready_for_review", "deployed"] as const;

export function isDeployableStatus(status: string): boolean {
  return (DEPLOYABLE_STATUSES as readonly string[]).includes(status);
}

/** The five operator steps, in rail order. */
export const WIZARD_STEPS = [
  { n: 1, key: "setup", label: "Setup" },
  { n: 2, key: "content", label: "Content" },
  { n: 3, key: "images", label: "Images" },
  { n: 4, key: "build", label: "Build" },
  { n: 5, key: "review", label: "Review" },
] as const;

export type WizardStepN = 1 | 2 | 3 | 4 | 5;

/**
 * The step the operator should land on for a given status. While the pipeline
 * owns the run (queued/running/planning/building/failed) that's the tracker;
 * the human checkpoints are curating (step 3) and review/deployed (step 5).
 */
export function activeWizardStep(status: string): WizardStepN {
  if (status === "curating") return 3;
  if (status === "review" || status === "ready_for_review" || status === "deployed") return 5;
  return 4;
}

/**
 * Highest step reachable via the rail: operators may look back at earlier
 * steps (read-only where the status no longer allows edits) but never ahead
 * of what the pipeline has produced.
 */
export function maxReachedStep(status: string): WizardStepN {
  if (status === "curating") return 3;
  if (status === "review" || status === "ready_for_review" || status === "deployed") return 5;
  return 4;
}

/** Status pill map covering ALL v2 statuses (the v1 board only knew five). */
export const V2_STATUS_PILL: Record<string, { label: string; cls: string }> = {
  queued: { label: "Queued", cls: "bg-surface-2 text-text-muted" },
  running: { label: "Running", cls: "bg-accent-soft text-accent-ink" },
  planning: { label: "Planning", cls: "bg-accent-soft text-accent-ink" },
  curating: { label: "Awaiting curation", cls: "bg-notready-bg text-notready-fg" },
  building: { label: "Building", cls: "bg-accent-soft text-accent-ink" },
  review: { label: "Ready for review", cls: "bg-notready-bg text-notready-fg" },
  ready_for_review: { label: "Ready for review", cls: "bg-notready-bg text-notready-fg" },
  deployed: { label: "Deployed", cls: "bg-ready-bg text-ready-fg" },
  failed: { label: "Failed", cls: "bg-dropped-bg text-dropped-fg" },
};

export function statusPill(status: string): { label: string; cls: string } {
  return V2_STATUS_PILL[status] ?? V2_STATUS_PILL.queued;
}

/** Curation progress: how many slots have at least one selected image. */
export function slotProgress(slots: ImageSlot[]): { chosen: number; total: number } {
  return {
    chosen: slots.filter((s) => s.selected.length > 0).length,
    total: slots.length,
  };
}

/**
 * Live build ETA label for the pipeline tracker. While a run is in flight and
 * we have an `estimate_ms`, count down from the EARLIEST running step's
 * `started_at` + estimate → "~N min remaining". If no running step has a
 * timestamp yet (e.g. still queued), fall back to the typical "~N min".
 * Minutes are floored at 1 so we never show "~0 min". Returns null when there
 * is nothing meaningful to show (no estimate).
 */
export function buildEtaLabel(
  steps: GenStep[],
  estimateMs: number | null | undefined,
  now: number,
): string | null {
  if (!estimateMs || estimateMs <= 0) return null;
  const startedAts = steps
    .filter((s) => s.status === "running" && s.started_at)
    .map((s) => Date.parse(s.started_at as string))
    .filter((t) => Number.isFinite(t));
  if (startedAts.length > 0) {
    const remainingMs = Math.min(...startedAts) + estimateMs - now;
    return `~${Math.max(1, Math.round(remainingMs / 60000))} min remaining`;
  }
  return `~${Math.max(1, Math.round(estimateMs / 60000))} min`;
}

/**
 * Pure next-state for one click on an image candidate. Lets the curation UI
 * update the selection instantly (optimistically) and derive the exact array
 * to sync to the server, without a round-trip per click.
 * - already selected  -> removed
 * - room under pick_max -> added
 * - single-pick slot   -> the clicked url replaces the current pick
 * - multi-pick slot at pick_max -> unchanged, `full: true` (caller warns)
 */
export function applyToggle(
  selected: string[],
  url: string,
  pickMax: number,
): { selected: string[]; full: boolean } {
  if (selected.includes(url)) return { selected: selected.filter((u) => u !== url), full: false };
  if (selected.length < pickMax) return { selected: [...selected, url], full: false };
  if (pickMax === 1) return { selected: [url], full: false };
  return { selected, full: true };
}
