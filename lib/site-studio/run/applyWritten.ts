import type { ContentDoc, ContentDocPage } from "../schema";
import type { WriteResult } from "./writer";

/** A successful write — the only variant applyWritten accepts. Callers must
 *  already have checked `ok`; there is no such thing as applying a failure
 *  (never silently blank — a failed page stays reported, not merged). */
export type WrittenPage = Extract<WriteResult, { ok: true }>;

export interface FieldProvenance {
  written_by: "ai" | "operator";
  model?: string;
}

/** Per doc-page provenance: which agent last wrote the title, each text
 *  slot, and each repeat group. Keyed the same way the content itself is —
 *  title as its own field, slots/repeats by their id — so operator edits
 *  (Phase 3b) can flip individual entries to "operator" without touching the
 *  rest. */
export interface PageProvenance {
  title?: FieldProvenance;
  slots: Record<string, FieldProvenance>;
  repeats: Record<string, FieldProvenance>;
}

/** A ContentDoc with a parallel, per-doc-page provenance array riding
 *  alongside identity/theme/pages. contentDocSchema only validates the
 *  renderer-facing shape (identity/theme/pages) and strips unknown keys on
 *  parse, so a RunContentDoc still passes contentDocSchema.parse — the
 *  provenance is simply along for the ride for the cockpit and re-roll. */
export interface RunContentDoc extends ContentDoc {
  provenance: PageProvenance[];
}

const emptyProvenance = (count: number): PageProvenance[] =>
  Array.from({ length: count }, () => ({ slots: {}, repeats: {} }));

const clonePage = (page: ContentDocPage): ContentDocPage => ({
  ...page,
  slots: { ...page.slots },
  repeats: Object.fromEntries(Object.entries(page.repeats).map(([id, rows]) => [id, rows.map((r) => ({ ...r }))])),
});

const cloneProvenance = (p: PageProvenance): PageProvenance => ({
  ...(p.title ? { title: { ...p.title } } : {}),
  slots: { ...p.slots },
  repeats: { ...p.repeats },
});

/**
 * Pure merge of one page's successful WriteResult into the run's Content
 * Document, keyed by the doc-page INDEX (never `page_id` — a stamped
 * fan-out page repeats the same `page_id` with a distinct `output`, so index
 * is the only thing that safely tells two stamped instances apart; keying on
 * page_id here would make the second stamped page silently overwrite the
 * first). Sets the page's title, its text slot values, and its repeat rows;
 * image slots are never touched (the Writer was never asked about them, so
 * there is nothing of its to apply). Every field the write touched is
 * stamped `written_by:"ai"` in the doc's parallel provenance array. Does not
 * mutate its input — returns a new RunContentDoc.
 */
export function applyWritten(
  doc: ContentDoc | RunContentDoc,
  pageIndex: number,
  result: WrittenPage,
  model?: string,
): RunContentDoc {
  if (pageIndex < 0 || pageIndex >= doc.pages.length) {
    throw new RangeError(`applyWritten: page index ${pageIndex} is out of range (doc has ${doc.pages.length} pages)`);
  }

  const provenanceSource: PageProvenance[] =
    "provenance" in doc && Array.isArray((doc as RunContentDoc).provenance)
      ? (doc as RunContentDoc).provenance
      : emptyProvenance(doc.pages.length);
  const provenance = provenanceSource.map(cloneProvenance);

  const pages = doc.pages.map((page, i) => (i === pageIndex ? clonePage(page) : page));
  const target = pages[pageIndex];

  target.title = result.title;
  for (const [id, value] of Object.entries(result.slots)) target.slots[id] = value;
  for (const [id, rows] of Object.entries(result.repeats)) target.repeats[id] = rows.map((r) => ({ ...r }));

  const field: FieldProvenance = model ? { written_by: "ai", model } : { written_by: "ai" };
  const pageProvenance = provenance[pageIndex];
  pageProvenance.title = field;
  for (const id of Object.keys(result.slots)) pageProvenance.slots[id] = field;
  for (const id of Object.keys(result.repeats)) pageProvenance.repeats[id] = field;

  return {
    identity: doc.identity,
    theme: doc.theme,
    pages,
    provenance,
  };
}
