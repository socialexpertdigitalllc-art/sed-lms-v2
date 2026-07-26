import type { ContentDoc, ContentDocPage } from "../schema";
import { DISALLOWED, type WriteResult } from "./writer";

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
  /** The AI's value for a field, captured the FIRST time that field flips
   *  ai -> operator (see `applyOperatorEdit`) — never overwritten by a later
   *  operator edit of the same field, so a field edited, reverted, and
   *  edited again still restores the ORIGINAL AI text (Phase 4a revert,
   *  run/revert.ts). Only title/slots carry a backup — repeats have no
   *  revert-to-AI story in this phase. Cleared by `revertField` once it has
   *  restored the value, so a field's presence here doubles as "this field
   *  currently holds an operator edit that can be reverted." */
  ai_backup?: {
    title?: string;
    slots?: Record<string, string>;
  };
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

const cloneAiBackup = (b?: PageProvenance["ai_backup"]): PageProvenance["ai_backup"] | undefined =>
  b ? { ...(b.title !== undefined ? { title: b.title } : {}), slots: { ...(b.slots ?? {}) } } : undefined;

const cloneProvenance = (p: PageProvenance): PageProvenance => ({
  ...(p.title ? { title: { ...p.title } } : {}),
  slots: { ...p.slots },
  repeats: { ...p.repeats },
  ...(p.ai_backup ? { ai_backup: cloneAiBackup(p.ai_backup) } : {}),
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

export interface RewriteOptions {
  /** Merge only this one slot's value from the write result — title and
   *  repeats are left completely alone. Used by `rerollSlot`; a whole-page
   *  re-roll (the default) leaves this unset. */
  onlySlot?: string;
  /** Overwrite every field, including ones an operator has already hand-
   *  edited. Without this, any field currently stamped `written_by:
   *  "operator"` is skipped entirely — a re-roll must not silently clobber a
   *  human's edit (spec §7). */
  includeOperatorFields?: boolean;
  model?: string;
}

const isOperatorOwned = (field?: FieldProvenance): boolean => field?.written_by === "operator";

/**
 * Provenance-aware merge of a re-roll's WriteResult — the granular sibling of
 * `applyWritten` (used for the page's FIRST write, which always overwrites
 * everything unconditionally since there is nothing yet to protect).
 *
 *  - Whole-page re-roll (`onlySlot` unset): every field the write touched
 *    (title, each text slot, each repeat) is applied UNLESS its CURRENT
 *    provenance is already "operator" — unless `includeOperatorFields` is
 *    set, in which case every field is overwritten, exactly like
 *    `applyWritten`.
 *  - Slot re-roll (`onlySlot` set): ONLY that one slot's value from the
 *    result is applied; title and repeats are left completely alone even
 *    though the Writer returned fresh values for them too (the Writer always
 *    writes a whole page in one call — the merge is what cherry-picks).
 *    Callers are expected to have already refused the re-roll before ever
 *    reaching here when the target slot is operator-owned and
 *    `includeOperatorFields` is not set (see `rerollSlot`); this function
 *    does not re-check that on its own.
 *
 * GATE CHECK IS THE CALLER'S JOB, NOT THIS FUNCTION'S: `applyRewrite` never
 * looks at run status. Its only current callers, `rerollPage`/`rerollSlot`,
 * refuse off-gate via their own `requireGate` before ever calling this — a
 * future caller that invokes `applyRewrite` directly gets ZERO protection
 * from this layer and must implement that check itself.
 *
 * Does not mutate its input — returns a new RunContentDoc.
 */
export function applyRewrite(
  doc: ContentDoc | RunContentDoc,
  pageIndex: number,
  result: WrittenPage,
  opts: RewriteOptions = {},
): RunContentDoc {
  if (pageIndex < 0 || pageIndex >= doc.pages.length) {
    throw new RangeError(`applyRewrite: page index ${pageIndex} is out of range (doc has ${doc.pages.length} pages)`);
  }

  const provenanceSource: PageProvenance[] =
    "provenance" in doc && Array.isArray((doc as RunContentDoc).provenance)
      ? (doc as RunContentDoc).provenance
      : emptyProvenance(doc.pages.length);
  const provenance = provenanceSource.map(cloneProvenance);

  const pages = doc.pages.map((page, i) => (i === pageIndex ? clonePage(page) : page));
  const target = pages[pageIndex];
  const pageProvenance = provenance[pageIndex];
  const field: FieldProvenance = opts.model ? { written_by: "ai", model: opts.model } : { written_by: "ai" };
  const includeOperator = opts.includeOperatorFields === true;

  if (opts.onlySlot) {
    const value = result.slots[opts.onlySlot];
    if (value !== undefined) {
      target.slots[opts.onlySlot] = value;
      pageProvenance.slots[opts.onlySlot] = field;
    }
  } else {
    if (includeOperator || !isOperatorOwned(pageProvenance.title)) {
      target.title = result.title;
      pageProvenance.title = field;
    }
    for (const [id, value] of Object.entries(result.slots)) {
      if (includeOperator || !isOperatorOwned(pageProvenance.slots[id])) {
        target.slots[id] = value;
        pageProvenance.slots[id] = field;
      }
    }
    for (const [id, rows] of Object.entries(result.repeats)) {
      if (includeOperator || !isOperatorOwned(pageProvenance.repeats[id])) {
        target.repeats[id] = rows.map((r) => ({ ...r }));
        pageProvenance.repeats[id] = field;
      }
    }
  }

  return {
    identity: doc.identity,
    theme: doc.theme,
    pages,
    provenance,
  };
}

/** The provenance recorded for one doc-page, or an empty one when the doc
 *  (or this page) has never been written/edited yet. Exported so callers
 *  that need to make a decision BEFORE attempting a merge (e.g. `rerollSlot`
 *  refusing an operator-owned slot without spending an AI call) don't have
 *  to duplicate the "does this doc carry a provenance array yet" check. */
export function getPageProvenance(doc: ContentDoc | RunContentDoc, pageIndex: number): PageProvenance {
  const provenance: PageProvenance[] =
    "provenance" in doc && Array.isArray((doc as RunContentDoc).provenance)
      ? (doc as RunContentDoc).provenance
      : emptyProvenance(doc.pages.length);
  return provenance[pageIndex] ?? { slots: {}, repeats: {} };
}

export interface OperatorEdit {
  title?: string;
  slots?: Record<string, string>;
}

/**
 * Holds an operator's hand-typed edit to the SAME plain-text bar the
 * Writer's AI output is held to (writer.ts's `DISALLOWED`): no markup, no
 * template tokens, no bare links. `contentDocSchema`'s own `tokenFree` check
 * is narrower — it only blocks `{{`-style tokens — and would otherwise let
 * e.g. `<b>` or a raw URL through to be silently escaped or stripped at
 * render time, with no error at edit time. Returns a human-readable name for
 * the first offending field (e.g. `slot "index_s1"`), or null when the edit
 * is clean.
 */
export function findDisallowedEditField(edit: OperatorEdit): string | null {
  if (edit.title !== undefined && DISALLOWED.test(edit.title)) return "title";
  if (edit.slots) {
    for (const [id, value] of Object.entries(edit.slots)) {
      if (DISALLOWED.test(value)) return `slot "${id}"`;
    }
  }
  return null;
}

/**
 * Merge an OPERATOR's edit into one page. Unlike `applyWritten` (which always
 * sets every field a completed AI write touched), this only touches the
 * fields actually supplied — an operator fixing one headline must not blank
 * out the rest of the page. Stamps `written_by:"operator"` on every field it
 * touches, so a later AI re-roll (spec: "re-roll only touches AI-written
 * fields") leaves operator edits alone. Does not mutate its input. Callers
 * should run `findDisallowedEditField` first (this function does not
 * validate content on its own — it is a pure merge, same as `applyWritten`).
 *
 * REVERT BACKUP: the first time a field's provenance is about to flip away
 * from "operator" — i.e. it currently reads anything else (`"ai"`, or no
 * entry yet on a fresh doc) — its CURRENT value is copied into
 * `provenance.ai_backup` before being overwritten. That backup is never
 * touched again by this function: a second, third, ... operator edit of the
 * same field finds it already provenance:"operator" and skips the capture
 * entirely, so `ai_backup` always holds the ORIGINAL AI value, never the
 * most recent one. `revert.ts`'s `revertField` is the only thing that ever
 * clears it (after restoring it), which is what makes an edit -> revert ->
 * edit cycle back up the same original value both times.
 */
export function applyOperatorEdit(
  doc: ContentDoc | RunContentDoc,
  pageIndex: number,
  edit: OperatorEdit,
): RunContentDoc {
  if (pageIndex < 0 || pageIndex >= doc.pages.length) {
    throw new RangeError(`applyOperatorEdit: page index ${pageIndex} is out of range (doc has ${doc.pages.length} pages)`);
  }

  const provenanceSource: PageProvenance[] =
    "provenance" in doc && Array.isArray((doc as RunContentDoc).provenance)
      ? (doc as RunContentDoc).provenance
      : emptyProvenance(doc.pages.length);
  const provenance = provenanceSource.map(cloneProvenance);

  const pages = doc.pages.map((page, i) => (i === pageIndex ? clonePage(page) : page));
  const target = pages[pageIndex];
  const pageProvenance = provenance[pageIndex];
  const field: FieldProvenance = { written_by: "operator" };

  const backup = (): NonNullable<PageProvenance["ai_backup"]> => {
    if (!pageProvenance.ai_backup) pageProvenance.ai_backup = { slots: {} };
    if (!pageProvenance.ai_backup.slots) pageProvenance.ai_backup.slots = {};
    return pageProvenance.ai_backup;
  };

  if (edit.title !== undefined) {
    if (!isOperatorOwned(pageProvenance.title)) {
      const b = backup();
      if (b.title === undefined) b.title = target.title;
    }
    target.title = edit.title;
    pageProvenance.title = field;
  }
  if (edit.slots) {
    for (const [id, value] of Object.entries(edit.slots)) {
      if (!isOperatorOwned(pageProvenance.slots[id])) {
        const b = backup();
        if (b.slots![id] === undefined) b.slots![id] = target.slots[id];
      }
      target.slots[id] = value;
      pageProvenance.slots[id] = field;
    }
  }

  return {
    identity: doc.identity,
    theme: doc.theme,
    pages,
    provenance,
  };
}
