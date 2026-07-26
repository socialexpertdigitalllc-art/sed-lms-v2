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

/** repeatId -> row index (as a string key — JSON round-trips row indices as
 *  object keys anyway, so this is the shape the whole stack — provenance,
 *  ai_backup, the `/content` and `/revert` route bodies — uses consistently
 *  rather than introducing a numeric-vs-string split) -> slot id -> value. */
export type RepeatFieldMap<T> = Record<string, Record<string, Record<string, T>>>;

/** Per doc-page provenance: which agent last wrote the title, each text
 *  slot, and each REPEAT ROW FIELD. Keyed the same way the content itself
 *  is — title as its own field, slots by their id — except repeats, which
 *  are ROW-AWARE (Phase 4a): `repeats[repeatId][rowIndex][slotId]`, not one
 *  entry per repeat id. A repeat id's whole-group entry (the Phase 3b/4a-
 *  before-this-task shape) could not tell rows apart, so a mixed group where
 *  the operator edited only one row would have had no way to say "row 2 is
 *  operator, rows 1 and 3 are still ai" — this shape is what makes that
 *  distinction possible, and is what `applyOperatorEdit`/`revertField` and
 *  the `/content`/`/revert` routes all read and write. */
export interface PageProvenance {
  title?: FieldProvenance;
  slots: Record<string, FieldProvenance>;
  repeats: RepeatFieldMap<FieldProvenance>;
  /** The AI's value for a field, captured the FIRST time that field flips
   *  ai -> operator (see `applyOperatorEdit`) — never overwritten by a later
   *  operator edit of the same field, so a field edited, reverted, and
   *  edited again still restores the ORIGINAL AI text (Phase 4a revert,
   *  run/revert.ts). Cleared by `revertField` once it has restored the
   *  value, so a field's presence here doubles as "this field currently
   *  holds an operator edit that can be reverted." `repeats` here mirrors
   *  `PageProvenance.repeats`'s own row-aware shape. */
  ai_backup?: {
    title?: string;
    slots?: Record<string, string>;
    repeats?: RepeatFieldMap<string>;
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

/** Deep-clones a `RepeatFieldMap` (repeatId -> rowKey -> slotId -> T) — a
 *  shallow `{ ...m }` would leave every row/slot record shared with the
 *  input, which every `applyOperatorEdit`/`applyWritten`/`applyRewrite`
 *  mutation below would then leak straight through to it. */
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
  // Row-aware (Phase 4a): every row's every slot gets its own stamp, not one
  // stamp for the whole repeat id — see PageProvenance's own doc comment.
  for (const [id, rows] of Object.entries(result.repeats)) {
    const rowsProv: Record<string, Record<string, FieldProvenance>> = {};
    rows.forEach((row, rowIdx) => {
      const rowProv: Record<string, FieldProvenance> = {};
      for (const slotId of Object.keys(row)) rowProv[slotId] = field;
      rowsProv[String(rowIdx)] = rowProv;
    });
    pageProvenance.repeats[id] = rowsProv;
  }

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

  // FIX (review, Phase 4a): `includeOperatorFields` is a SECOND way a field's
  // provenance flips operator -> ai (the first is a plain AI write, which
  // never has a backup to worry about). Clearing an operator-owned field's
  // `ai_backup` here — ONLY when this call is the one doing the overriding —
  // is what stops a stale pre-re-roll value from resurfacing: without this,
  // a field written "v1" (ai) -> "v2" (operator, backup="v1") -> "v3"
  // (override re-roll, provenance flips to ai, backup left at stale "v1") ->
  // "v4" (operator again — the capture-once rule skips it because a backup
  // already exists) -> revert would restore "v1", text the CURRENT ai pass
  // never produced. Clearing it here means a later operator edit re-captures
  // the CURRENT (re-rolled) value instead.
  // (Repeats are NOT handled through this helper — see the repeat-merge
  // block below, which rebuilds each repeat id's whole `ai_backup` map from
  // scratch instead, precisely so a row that disappears from the merge can
  // never leave an orphaned backup entry behind. See FIX 2's doc comment
  // there for why a per-key `delete` here isn't enough for repeats.)
  const clearBackupIfOverriding = (kind: "title" | "slot", id?: string) => {
    if (!includeOperator || !pageProvenance.ai_backup) return;
    if (kind === "title") delete pageProvenance.ai_backup.title;
    else if (kind === "slot" && id !== undefined) delete pageProvenance.ai_backup.slots?.[id];
  };

  if (opts.onlySlot) {
    const value = result.slots[opts.onlySlot];
    if (value !== undefined) {
      clearBackupIfOverriding("slot", opts.onlySlot);
      target.slots[opts.onlySlot] = value;
      pageProvenance.slots[opts.onlySlot] = field;
    }
  } else {
    if (includeOperator || !isOperatorOwned(pageProvenance.title)) {
      clearBackupIfOverriding("title");
      target.title = result.title;
      pageProvenance.title = field;
    }
    for (const [id, value] of Object.entries(result.slots)) {
      if (includeOperator || !isOperatorOwned(pageProvenance.slots[id])) {
        clearBackupIfOverriding("slot", id);
        target.slots[id] = value;
        pageProvenance.slots[id] = field;
      }
    }
    // Row-aware (Phase 4a): each row/slot is judged on its OWN provenance,
    // not the repeat id as a whole — a re-roll now overwrites the AI-owned
    // rows/slots in a mixed group while leaving an operator-owned row/slot
    // exactly as it was, the same protection `applyOperatorEdit`'s own
    // fields already get.
    //
    // FIX 2 (Phase 4a review) — SHRINK MUST NOT DESTROY AN OPERATOR ROW: the
    // loop below only ever walked `rows` (the NEW write result), so when a
    // re-roll returns FEWER rows than the doc currently holds, any row at an
    // index beyond the new length was never visited at all — its per-slot
    // operator-ownership check never ran, `target.repeats[id] = mergedRows`
    // (a full replace) simply dropped it, and `ai_backup` for that row was
    // untouched by the old code (it was only ever cleared per-key via
    // `clearBackupIfOverriding`, which nothing beyond the new length ever
    // called). Confirmed end-to-end: shrink 3 rows -> 2 -> regrow -> operator
    // edits row 3 again -> revert restored a value from TWO generations
    // earlier, because the orphaned backup outlived the row it belonged to
    // and `applyOperatorEdit`'s capture-once rule trusted it as still valid.
    //
    // The fix has two parts, both below: (1) any row beyond the new result's
    // length that carries an operator-owned field is APPENDED BACK after the
    // new rows, so the operator's work survives a shrink instead of vanishing
    // silently; a row beyond the new length with no operator-owned field is
    // still dropped — that IS the AI's intended shrink, nothing to protect.
    // (2) `pageProvenance.repeats[id]` and `ai_backup.repeats[id]` are both
    // REBUILT FROM SCRATCH from the final merged rows (not mutated key-by-
    // key), so a dropped row's backup can never linger under a stale index —
    // and a row that IS preserved but ends up at a new array position (its
    // old index may no longer be free) has its provenance/backup carried to
    // the SAME new position as its content, since every later revert
    // addresses a row by its CURRENT index.
    for (const [id, rows] of Object.entries(result.repeats)) {
      const currentRows = target.repeats[id] ?? [];
      const currentRowsProv = pageProvenance.repeats[id] ?? {};
      const currentRowsBackup = pageProvenance.ai_backup?.repeats?.[id] ?? {};

      const mergedRows: Record<string, string>[] = [];
      const mergedProv: Record<string, Record<string, FieldProvenance>> = {};
      const mergedBackup: Record<string, Record<string, string>> = {};

      const pushRow = (row: Record<string, string>, rowProv: Record<string, FieldProvenance>, rowBackup?: Record<string, string>) => {
        const newKey = String(mergedRows.length);
        mergedRows.push(row);
        mergedProv[newKey] = rowProv;
        if (rowBackup && Object.keys(rowBackup).length > 0) mergedBackup[newKey] = rowBackup;
      };

      // 1. The new write result's rows, same per-slot protection as before.
      rows.forEach((row, rowIdx) => {
        const rowKey = String(rowIdx);
        const existingRow = currentRows[rowIdx];
        const existingRowProv = currentRowsProv[rowKey] ?? {};
        const existingRowBackup = currentRowsBackup[rowKey] ?? {};
        const mergedRow: Record<string, string> = {};
        const mergedRowProv: Record<string, FieldProvenance> = { ...existingRowProv };
        const mergedRowBackup: Record<string, string> = { ...existingRowBackup };

        for (const [slotId, value] of Object.entries(row)) {
          if (!includeOperator && isOperatorOwned(existingRowProv[slotId])) {
            // Operator-owned and no override: keep the CURRENT value (the
            // operator's edit), not the fresh AI value the write returned.
            mergedRow[slotId] = existingRow?.[slotId] ?? value;
          } else {
            // Overriding this slot — same "second way a field flips
            // operator -> ai" backup-staleness fix as title/slots above,
            // just applied to the local copy that gets rebuilt below.
            if (includeOperator) delete mergedRowBackup[slotId];
            mergedRow[slotId] = value;
            mergedRowProv[slotId] = field;
          }
        }
        pushRow(mergedRow, mergedRowProv, mergedRowBackup);
      });

      // 2. Any row beyond the new result's length: preserve it (content,
      // provenance, and backup, unchanged) if the operator owns any field on
      // it — otherwise let it drop, which is the AI's own intended shrink.
      for (let i = rows.length; i < currentRows.length; i++) {
        const rowKey = String(i);
        const rowProv = currentRowsProv[rowKey] ?? {};
        const operatorOwnsRow = Object.values(rowProv).some((f) => isOperatorOwned(f));
        if (operatorOwnsRow) {
          pushRow({ ...currentRows[i] }, { ...rowProv }, { ...(currentRowsBackup[rowKey] ?? {}) });
        }
        // else: dropped. Its `ai_backup` entry (if any) is dropped with it —
        // `mergedBackup` is rebuilt from scratch below, so there is nothing
        // left to explicitly delete.
      }

      target.repeats[id] = mergedRows;
      pageProvenance.repeats[id] = mergedProv;
      if (Object.keys(mergedBackup).length > 0) {
        if (!pageProvenance.ai_backup) pageProvenance.ai_backup = { slots: {} };
        if (!pageProvenance.ai_backup.repeats) pageProvenance.ai_backup.repeats = {};
        pageProvenance.ai_backup.repeats[id] = mergedBackup;
      } else if (pageProvenance.ai_backup?.repeats) {
        delete pageProvenance.ai_backup.repeats[id];
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
  /** repeatId -> row index (string key) -> slot id -> value — same
   *  row-aware shape as `PageProvenance.repeats`. */
  repeats?: RepeatFieldMap<string>;
}

/**
 * Holds an operator's hand-typed edit to the SAME plain-text bar the
 * Writer's AI output is held to (writer.ts's `DISALLOWED`): no markup, no
 * template tokens, no bare links. `contentDocSchema`'s own `tokenFree` check
 * is narrower — it only blocks `{{`-style tokens — and would otherwise let
 * e.g. `<b>` or a raw URL through to be silently escaped or stripped at
 * render time, with no error at edit time. Returns a human-readable name for
 * the first offending field (e.g. `slot "index_s1"`, or
 * `repeat "index_r1" row 2 slot "index_r1_s1"`), or null when the edit is
 * clean.
 */
export function findDisallowedEditField(edit: OperatorEdit): string | null {
  if (edit.title !== undefined && DISALLOWED.test(edit.title)) return "title";
  if (edit.slots) {
    for (const [id, value] of Object.entries(edit.slots)) {
      if (DISALLOWED.test(value)) return `slot "${id}"`;
    }
  }
  if (edit.repeats) {
    for (const [repeatId, rows] of Object.entries(edit.repeats)) {
      for (const [rowKey, slotValues] of Object.entries(rows)) {
        for (const [slotId, value] of Object.entries(slotValues)) {
          if (DISALLOWED.test(value)) return `repeat "${repeatId}" row ${rowKey} slot "${slotId}"`;
        }
      }
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
 *
 * IMAGE SLOTS ARE NEVER BACKED UP (review fix, Phase 4a): an image slot's
 * value BEFORE any pick is the TEMPLATE'S OWN DEMO SAMPLE (seed.ts seeds
 * every image slot from `slot.sample`, never from an AI write — the Writer
 * is never even asked about images). Backing that up and letting a later
 * `revertField` restore it would reinstate the vendor's stock placeholder
 * photo on a client's live site, labelled `written_by:"ai"` as if the model
 * had produced it. `imageSlotIds` — the set of this PAGE's slot ids the
 * template manifest declares `type:"image"` — is how this function tells
 * those apart from text slots; the caller (the images route, which already
 * loads the manifest to validate the pick itself) is the one that computes
 * it. Omitting it entirely (as `/content`, a text-only editor, does) leaves
 * old behaviour unchanged — it is on the CALLER to pass it whenever `edit`
 * might touch an image slot. (`imageSlotIds` is checked only against
 * `edit.slots` today — no caller currently edits a repeat-row IMAGE slot
 * through this function, so that exclusion has no repeat-row counterpart
 * yet; a future caller doing so would need to extend this the same way.)
 *
 * REPEAT ROWS ARE ROW-AWARE (Phase 4a): `edit.repeats[repeatId][rowIndex]
 * [slotId]` touches exactly that one row's one field — a sibling row in the
 * same repeat (or a different field on the SAME row) is left completely
 * alone, both in the content (`target.repeats[repeatId][rowIndex]`) and in
 * provenance/backup (`pageProvenance.repeats[repeatId][rowIndex]`). This is
 * what lets a mixed repeat group — say, three service cards where the
 * operator hand-edited only the middle one — revert independently per row
 * (see `revert.ts`'s `revertField`) rather than only as a whole group.
 */
export function applyOperatorEdit(
  doc: ContentDoc | RunContentDoc,
  pageIndex: number,
  edit: OperatorEdit,
  imageSlotIds?: ReadonlySet<string>,
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
    if (!pageProvenance.ai_backup.repeats) pageProvenance.ai_backup.repeats = {};
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
      const isImageSlot = imageSlotIds?.has(id) === true;
      if (!isImageSlot && !isOperatorOwned(pageProvenance.slots[id])) {
        const b = backup();
        if (b.slots![id] === undefined) b.slots![id] = target.slots[id];
      }
      target.slots[id] = value;
      pageProvenance.slots[id] = field;
    }
  }
  if (edit.repeats) {
    for (const [repeatId, rows] of Object.entries(edit.repeats)) {
      const targetRows = target.repeats[repeatId];
      for (const [rowKey, slotValues] of Object.entries(rows)) {
        const rowIdx = Number(rowKey);
        if (!targetRows || !Number.isInteger(rowIdx) || rowIdx < 0 || rowIdx >= targetRows.length) {
          throw new RangeError(
            `applyOperatorEdit: repeat "${repeatId}" row ${rowKey} is out of range (page ${pageIndex})`,
          );
        }
        if (!pageProvenance.repeats[repeatId]) pageProvenance.repeats[repeatId] = {};
        const repeatProv = pageProvenance.repeats[repeatId];
        if (!repeatProv[rowKey]) repeatProv[rowKey] = {};
        const rowProv = repeatProv[rowKey];

        for (const [slotId, value] of Object.entries(slotValues)) {
          if (!isOperatorOwned(rowProv[slotId])) {
            const b = backup();
            if (!b.repeats![repeatId]) b.repeats![repeatId] = {};
            if (!b.repeats![repeatId][rowKey]) b.repeats![repeatId][rowKey] = {};
            const rowBackup = b.repeats![repeatId][rowKey];
            if (rowBackup[slotId] === undefined) rowBackup[slotId] = targetRows[rowIdx][slotId];
          }
          targetRows[rowIdx][slotId] = value;
          rowProv[slotId] = field;
        }
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
