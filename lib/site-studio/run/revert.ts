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
 * Returns `{ok:false}` — never a silent no-op — when there is no backup for
 * the requested field: either it was never operator-edited, or it already
 * was reverted once. A caller (the `/revert` route) turns that into a 422,
 * not a 200 that pretends something happened.
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
    const value = pageProvenance.ai_backup?.title;
    if (value === undefined) {
      return { ok: false, error: `revert refused: page ${pageIndex}'s title has no AI backup to restore` };
    }
    page.title = value;
    pageProvenance.title = { written_by: "ai" };
    delete pageProvenance.ai_backup!.title;
  } else {
    const { slotId } = target;
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
