import type { ContentDoc } from "../schema";
import { type PageProvenance, type RepeatFieldMap, type RunContentDoc } from "./applyWritten";

/** Which single field on a doc-page to revert — exactly one of the three.
 *  Mirrors the `/revert` route body (`{ page_index, slot_id?, title?,
 *  repeat? }`): a slot id, `title: true`, or a repeat-row target
 *  (`repeatId`/`rowIndex`/`slotId` — same row-aware addressing as
 *  `applyOperatorEdit`'s `OperatorEdit.repeats`). */
export type RevertTarget =
  | { slotId: string }
  | { title: true }
  | { repeat: { repeatId: string; rowIndex: number; slotId: string } };

export type RevertResult =
  | { ok: true; doc: RunContentDoc }
  | { ok: false; error: string };

const emptyProvenance = (count: number): PageProvenance[] =>
  Array.from({ length: count }, () => ({ slots: {}, repeats: {} }));

const clonePage = <T extends ContentDoc["pages"][number]>(page: T): T => ({
  ...page,
  slots: { ...page.slots },
  repeats: Object.fromEntries(Object.entries(page.repeats).map(([id, rows]) => [id, rows.map((r) => ({ ...r }))])),
});

/** Deep-clones a `RepeatFieldMap` (repeatId -> rowKey -> slotId -> T) — see
 *  applyWritten.ts's own `cloneRepeatFieldMap`, mirrored here so this module
 *  stays free of a runtime dependency on that one (only its types are
 *  imported). */
function cloneRepeatFieldMap<T>(m: RepeatFieldMap<T>): RepeatFieldMap<T> {
  const out: RepeatFieldMap<T> = {};
  for (const [repeatId, rows] of Object.entries(m)) {
    const rowsOut: Record<string, Record<string, T>> = {};
    for (const [rowKey, slots] of Object.entries(rows)) rowsOut[rowKey] = { ...slots };
    out[repeatId] = rowsOut;
  }
  return out;
}

const cloneAiBackup = (b?: PageProvenance["ai_backup"]): PageProvenance["ai_backup"] | undefined =>
  b
    ? {
        ...(b.title !== undefined ? { title: b.title } : {}),
        slots: { ...(b.slots ?? {}) },
        ...(b.repeats ? { repeats: cloneRepeatFieldMap(b.repeats) } : {}),
      }
    : undefined;

const cloneProvenance = (p: PageProvenance): PageProvenance => ({
  ...(p.title ? { title: { ...p.title } } : {}),
  slots: { ...p.slots },
  repeats: cloneRepeatFieldMap(p.repeats),
  ...(p.ai_backup ? { ai_backup: cloneAiBackup(p.ai_backup) } : {}),
});

/**
 * Restores one field on one doc-page to the AI value `applyOperatorEdit`
 * backed up the first time an operator touched it (see that function's own
 * doc comment on `ai_backup`) — flips the field's provenance back to `"ai"`
 * and clears the backup entry, so the field reads exactly as if the operator
 * edit had never happened, and a SECOND revert attempt correctly reports
 * there is nothing left to restore.
 *
 * REFUSES UNLESS THE FIELD'S CURRENT PROVENANCE IS "operator" (review fix,
 * Phase 4a) — checking backup-existence alone is not enough: `applyRewrite`'s
 * `includeOperatorFields` override is a SECOND way a field flips
 * operator -> ai (the first is `revertField` itself), and immediately after
 * that override the field reads "ai" while its `ai_backup` may still (bug)
 * or may no longer (fixed) hold a value from BEFORE the re-roll. Gating on
 * current provenance, not merely on backup presence, means a revert can
 * never fire against a field the operator does not currently own — a direct
 * `POST /revert` right after a re-roll is refused even if some backup
 * happened to survive, rather than silently resurrecting pre-re-roll text.
 *
 * Returns `{ok:false}` — never a silent no-op — when the field isn't
 * currently an operator edit, or (the ordinary case) has no backup at all:
 * never operator-edited, or already reverted once. A caller (the `/revert`
 * route) turns that into a 422, not a 200 that pretends something happened.
 *
 * Pure: does not mutate `doc`; a revert of one field never touches any other
 * field, any other page, or any other part of provenance (including a
 * DIFFERENT field's own `ai_backup` entry on the same page). This includes a
 * REPEAT-ROW target (Phase 4a, `{ repeat: { repeatId, rowIndex, slotId } }`):
 * it is judged and restored against that exact row+slot's own provenance and
 * backup only — a sibling row in the same repeat, or a different slot on the
 * same row, is never disturbed by reverting one field.
 */
export function revertField(
  doc: ContentDoc | RunContentDoc,
  pageIndex: number,
  target: RevertTarget,
): RevertResult {
  if (pageIndex < 0 || pageIndex >= doc.pages.length) {
    throw new RangeError(`revertField: page index ${pageIndex} is out of range (doc has ${doc.pages.length} pages)`);
  }

  const provenanceSource: PageProvenance[] =
    "provenance" in doc && Array.isArray((doc as RunContentDoc).provenance)
      ? (doc as RunContentDoc).provenance
      : emptyProvenance(doc.pages.length);
  const provenance = provenanceSource.map(cloneProvenance);
  const pageProvenance = provenance[pageIndex];

  const pages = doc.pages.map((page, i) => (i === pageIndex ? clonePage(page) : page));
  const page = pages[pageIndex];

  if ("title" in target) {
    if (pageProvenance.title?.written_by !== "operator") {
      return { ok: false, error: `revert refused: page ${pageIndex}'s title is not currently an operator edit` };
    }
    const value = pageProvenance.ai_backup?.title;
    if (value === undefined) {
      return { ok: false, error: `revert refused: page ${pageIndex}'s title has no AI backup to restore` };
    }
    page.title = value;
    pageProvenance.title = { written_by: "ai" };
    delete pageProvenance.ai_backup!.title;
  } else if ("repeat" in target) {
    // Row-aware (Phase 4a): a repeat-row field's revert is judged and
    // restored entirely on its OWN row+slot — a sibling row in the same
    // repeat (or a different field on the same row) is never touched, even
    // when this is the very same call (see this file's own doc comment).
    const { repeatId, rowIndex, slotId } = target.repeat;
    const rowKey = String(rowIndex);
    if (pageProvenance.repeats[repeatId]?.[rowKey]?.[slotId]?.written_by !== "operator") {
      return {
        ok: false,
        error: `revert refused: repeat "${repeatId}" row ${rowIndex} slot "${slotId}" on page ${pageIndex} is not currently an operator edit`,
      };
    }
    const value = pageProvenance.ai_backup?.repeats?.[repeatId]?.[rowKey]?.[slotId];
    if (value === undefined) {
      return {
        ok: false,
        error: `revert refused: repeat "${repeatId}" row ${rowIndex} slot "${slotId}" on page ${pageIndex} has no AI backup to restore`,
      };
    }
    const rows = page.repeats[repeatId];
    if (!rows || rowIndex < 0 || rowIndex >= rows.length) {
      return {
        ok: false,
        error: `revert refused: repeat "${repeatId}" row ${rowIndex} on page ${pageIndex} is out of range`,
      };
    }
    rows[rowIndex][slotId] = value;
    pageProvenance.repeats[repeatId][rowKey][slotId] = { written_by: "ai" };
    delete pageProvenance.ai_backup!.repeats![repeatId][rowKey][slotId];
  } else {
    const { slotId } = target;
    if (pageProvenance.slots[slotId]?.written_by !== "operator") {
      return { ok: false, error: `revert refused: slot "${slotId}" on page ${pageIndex} is not currently an operator edit` };
    }
    const value = pageProvenance.ai_backup?.slots?.[slotId];
    if (value === undefined) {
      return { ok: false, error: `revert refused: slot "${slotId}" on page ${pageIndex} has no AI backup to restore` };
    }
    page.slots[slotId] = value;
    pageProvenance.slots[slotId] = { written_by: "ai" };
    delete pageProvenance.ai_backup!.slots![slotId];
  }

  return {
    ok: true,
    doc: {
      identity: doc.identity,
      theme: doc.theme,
      pages,
      provenance,
    },
  };
}
