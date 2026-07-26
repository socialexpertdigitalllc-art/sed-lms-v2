import type { ContentDoc } from "../schema";
import { type PageProvenance, type RunContentDoc } from "./applyWritten";

/** Which single field on a doc-page to revert — exactly one of the two.
 *  Mirrors the `/revert` route body (`{ page_index, slot_id?, title? }`, see
 *  Task 6): a slot id, or `title: true`. */
export type RevertTarget = { slotId: string } | { title: true };

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

const cloneAiBackup = (b?: PageProvenance["ai_backup"]): PageProvenance["ai_backup"] | undefined =>
  b ? { ...(b.title !== undefined ? { title: b.title } : {}), slots: { ...(b.slots ?? {}) } } : undefined;

const cloneProvenance = (p: PageProvenance): PageProvenance => ({
  ...(p.title ? { title: { ...p.title } } : {}),
  slots: { ...p.slots },
  repeats: { ...p.repeats },
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
 * DIFFERENT field's own `ai_backup` entry on the same page).
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
