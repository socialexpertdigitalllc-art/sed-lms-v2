import type { TemplateManifest } from "../schema";
import type { Dossier } from "./dossier";
import type { StudioRunRow } from "./types";
import { writePage, type AiCall } from "./writer";
import { applyRewrite, getPageProvenance, type RunContentDoc } from "./applyWritten";

/** The model-call seam re-roll shares with the engine's write step — same
 *  shape as `RunStepDeps.aiCall`, kept separate so this pure core never
 *  imports the engine (or `admin`) directly. */
export interface RerollDeps {
  aiCall: AiCall;
}

export interface RerollOptions {
  /** Overwrite fields even where an operator has already hand-edited them.
   *  Without this, operator-owned fields are protected (whole-page re-roll)
   *  or the whole call is refused (slot re-roll). */
  includeOperatorFields?: boolean;
}

export type RerollOutcome =
  | { ok: true; doc: RunContentDoc }
  | { ok: false; error: string };

/** Re-roll is a Gate 1 activity in 3b — refuse anywhere else in the machine,
 *  before ever touching the model. */
function requireGate(run: StudioRunRow): string | null {
  if (run.status !== "reviewing") {
    return `re-roll refused: the run is not at the gate (status is "${run.status}", not "reviewing")`;
  }
  return null;
}

function pageAt(doc: RunContentDoc | StudioRunRow["content_doc"], pageIndex: number) {
  if (!doc) return null;
  if (pageIndex < 0 || pageIndex >= doc.pages.length) return null;
  return doc.pages[pageIndex];
}

/**
 * Re-rolls one whole doc-page: re-runs the same Writer call `runWrite` uses
 * for that page (same prompt path — stamp value included for a fan-out
 * page), then merges the result with `applyRewrite`, which by default skips
 * any field an operator has already hand-edited (spec §7: "AI-written
 * fields only unless explicitly confirmed"). Pass `{includeOperatorFields:
 * true}` to overwrite everything, matching a confirmed operator override.
 * A failed write (`ok:false` from the model) reports the error and never
 * touches the doc — the caller's `run.content_doc` is left exactly as it
 * was, since this function only ever returns a NEW doc on success.
 */
export async function rerollPage(
  deps: RerollDeps,
  manifest: TemplateManifest,
  dossier: Dossier,
  run: StudioRunRow,
  docPageIndex: number,
  opts: RerollOptions = {},
): Promise<RerollOutcome> {
  const gateError = requireGate(run);
  if (gateError) return { ok: false, error: gateError };

  const doc = run.content_doc;
  const page = pageAt(doc, docPageIndex);
  if (!doc || !page) {
    return { ok: false, error: `re-roll refused: page index ${docPageIndex} is out of range` };
  }

  const def = manifest.pages.find((p) => p.id === page.page_id);
  if (!def) {
    return { ok: false, error: `re-roll refused: page "${page.page_id}" is not in the template manifest` };
  }

  const result = await writePage(def, dossier, { stampValue: page.nav_title }, deps.aiCall);
  if (!result.ok) return { ok: false, error: result.error };

  const rewritten = applyRewrite(doc, docPageIndex, result, {
    includeOperatorFields: opts.includeOperatorFields,
  });
  return { ok: true, doc: rewritten };
}

/**
 * Re-rolls a single image-adjacent TEXT slot on a page: the Writer still
 * writes the whole page in one call (cheap and honest — no per-slot prompt
 * exists), but the merge cherry-picks only the named slot; title and repeats
 * are left completely alone. Refuses outright — before ever calling the
 * model — when that slot's current provenance is "operator" and
 * `includeOperatorFields` was not set, so a rejected re-roll never spends an
 * AI call.
 */
export async function rerollSlot(
  deps: RerollDeps,
  manifest: TemplateManifest,
  dossier: Dossier,
  run: StudioRunRow,
  docPageIndex: number,
  slotId: string,
  opts: RerollOptions = {},
): Promise<RerollOutcome> {
  const gateError = requireGate(run);
  if (gateError) return { ok: false, error: gateError };

  const doc = run.content_doc;
  const page = pageAt(doc, docPageIndex);
  if (!doc || !page) {
    return { ok: false, error: `re-roll refused: page index ${docPageIndex} is out of range` };
  }

  const def = manifest.pages.find((p) => p.id === page.page_id);
  if (!def) {
    return { ok: false, error: `re-roll refused: page "${page.page_id}" is not in the template manifest` };
  }
  if (!def.slots.some((s) => s.id === slotId)) {
    return { ok: false, error: `re-roll refused: slot "${slotId}" is not defined on page "${page.page_id}"` };
  }

  if (!opts.includeOperatorFields) {
    const provenance = getPageProvenance(doc, docPageIndex);
    if (provenance.slots[slotId]?.written_by === "operator") {
      return {
        ok: false,
        error: `re-roll refused: slot "${slotId}" holds an operator edit (pass includeOperatorFields to override)`,
      };
    }
  }

  const result = await writePage(def, dossier, { stampValue: page.nav_title }, deps.aiCall);
  if (!result.ok) return { ok: false, error: result.error };
  if (!(slotId in result.slots)) {
    return { ok: false, error: `re-roll: the writer did not return slot "${slotId}"` };
  }

  const rewritten = applyRewrite(doc, docPageIndex, result, {
    onlySlot: slotId,
    includeOperatorFields: opts.includeOperatorFields,
  });
  return { ok: true, doc: rewritten };
}
