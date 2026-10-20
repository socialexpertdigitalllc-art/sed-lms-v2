// lib/contracts/docEdit.ts
/**
 * Editing a generated contract's Google Doc from the dashboard. PURE: turns
 * the Docs API's document structure into editable paragraphs, and a set of
 * paragraph edits back into Docs batchUpdate requests.
 *
 * The doc stays the source of truth — so the PDF keeps the template's fonts,
 * headings and layout. Edits touch ONLY what changed: a reworded paragraph
 * deletes and inserts just the differing middle, so bold labels and other
 * formatting around it survive. Requests are ordered from the end of the doc
 * backwards, so each one's indices are still valid when it runs.
 *
 * Docs indices count UTF-16 code units — the same unit JavaScript strings
 * index in, so string lengths are used directly.
 */

import { formatUsd } from "./merge";
import { paymentTermsText, type PaymentPlan } from "./payments";

export interface DocBlock {
  /** Stable for one revision: the paragraph's start index. */
  key: string;
  startIndex: number;
  /** Exclusive; the paragraph's own newline sits at endIndex - 1. */
  endIndex: number;
  /** Without the trailing newline; soft line breaks (\u000b) shown as \n. */
  text: string;
  /** NORMAL_TEXT, HEADING_1 … , TITLE, SUBTITLE. */
  style: string;
  bullet: boolean;
  inTable: boolean;
  /** False when the paragraph holds an image, signature or other non-text element. */
  editable: boolean;
  /** False for the last paragraph of the body or of a table cell, and right
   *  before a table — Docs won't delete those newlines; "remove" clears instead. */
  removable: boolean;
}

type RawParagraph = {
  elements?: { startIndex?: number; endIndex?: number; textRun?: { content?: string } }[];
  paragraphStyle?: { namedStyleType?: string };
  bullet?: unknown;
};
type RawElement = {
  startIndex?: number;
  endIndex?: number;
  paragraph?: RawParagraph;
  table?: { tableRows?: { tableCells?: { content?: RawElement[] }[] }[] };
};

const VT = "\u000b";
export const toDisplay = (s: string) => s.split(VT).join("\n");
/** A typed line break inside a paragraph becomes a soft break, not a new paragraph. */
export const toDoc = (s: string) => s.replace(/\r\n?/g, "\n").split("\n").join(VT);

function walk(content: RawElement[], inTable: boolean, out: DocBlock[]): void {
  content.forEach((el, i) => {
    if (el.paragraph && typeof el.startIndex === "number" && typeof el.endIndex === "number") {
      const els = el.paragraph.elements ?? [];
      const textOnly = els.every((e) => e.textRun && typeof e.textRun.content === "string");
      const raw = els.map((e) => e.textRun?.content ?? "").join("");
      const consistent = raw.length === el.endIndex - el.startIndex && raw.endsWith("\n");
      const next = content[i + 1];
      const last = i === content.length - 1 || !next;
      const beforeStructure = !!next && !next.paragraph;
      out.push({
        key: String(el.startIndex),
        startIndex: el.startIndex,
        endIndex: el.endIndex,
        text: toDisplay(consistent ? raw.slice(0, -1) : raw.replace(/\n$/, "")),
        style: el.paragraph.paragraphStyle?.namedStyleType ?? "NORMAL_TEXT",
        bullet: !!el.paragraph.bullet,
        inTable,
        editable: textOnly && consistent,
        removable: !last && !beforeStructure,
      });
    } else if (el.table) {
      for (const row of el.table.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) walk(cell.content ?? [], true, out);
      }
    }
    // sectionBreak / tableOfContents: not editable, nothing to show.
  });
}

/** The doc's paragraphs, in order. */
export function docToBlocks(body: { content?: unknown[] }): DocBlock[] {
  const out: DocBlock[] = [];
  walk((body.content ?? []) as RawElement[], false, out);
  return out;
}

/** What the editor sends back, keyed by the block's start index. */
export type BlockEdit =
  | { op: "replace"; key: string; oldText: string; text: string }
  | { op: "remove"; key: string; oldText: string }
  | { op: "insert_after"; key: string; paragraphs: string[] };

/** The changed middle of two strings: [from, oldEnd) in `a` becomes `insert`. */
export function diffMiddle(a: string, b: string): { from: number; oldEnd: number; insert: string } {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  return { from: p, oldEnd: a.length - q, insert: b.slice(p, b.length - q) };
}

const isHeading = (style: string) => /^(HEADING_|TITLE|SUBTITLE)/.test(style);

type Plan = { at: number; order: number; requests: unknown[] };

/** An edit that can't be applied as asked — its message is for the person. */
export class BlockEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockEditError";
  }
}

/**
 * Edits → Docs requests, last position first. Throws (with a message for the
 * person) when an edit names a paragraph that no longer matches — the doc
 * moved on, or the edit targets something read-only.
 */
export function buildEditRequests(blocks: DocBlock[], edits: BlockEdit[]): unknown[] {
  const byKey = new Map(blocks.map((b) => [b.key, b]));
  const removed = new Set(edits.filter((e) => e.op === "remove").map((e) => e.key));
  const plans: Plan[] = [];

  const block = (key: string): DocBlock => {
    const b = byKey.get(key);
    if (!b) throw new BlockEditError("A paragraph you edited is no longer in the contract — reload and try again.");
    return b;
  };
  const same = (b: DocBlock, oldText: string) => {
    if (b.text !== oldText) throw new BlockEditError("The contract changed since you opened it — reload and make your edits again.");
    if (!b.editable) throw new BlockEditError("That paragraph holds an image or signature and can't be edited here.");
  };

  /** Replace [s, e) of the doc's text (doc-format string) minimally. */
  const rewrite = (start: number, oldDoc: string, newDoc: string): unknown[] => {
    const d = diffMiddle(oldDoc, newDoc);
    const reqs: unknown[] = [];
    if (d.oldEnd > d.from) {
      reqs.push({ deleteContentRange: { range: { startIndex: start + d.from, endIndex: start + d.oldEnd } } });
    }
    if (d.insert) reqs.push({ insertText: { location: { index: start + d.from }, text: d.insert } });
    return reqs;
  };

  /** Plain body text for new paragraphs: no inherited bold/italic/underline,
   *  and not a heading just because it follows one. */
  const tidyNew = (from: number, length: number, after: DocBlock): unknown[] => {
    if (length <= 0) return [];
    const reqs: unknown[] = [
      { updateTextStyle: { range: { startIndex: from, endIndex: from + length }, textStyle: {}, fields: "bold,italic,underline" } },
    ];
    if (isHeading(after.style)) {
      reqs.push({ updateParagraphStyle: { range: { startIndex: from, endIndex: from + length }, paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, fields: "namedStyleType" } });
    }
    return reqs;
  };

  for (const e of edits) {
    const b = block(e.key);
    if (e.op === "replace") {
      if (removed.has(e.key)) continue;
      same(b, e.oldText);
      const reqs = rewrite(b.startIndex, toDoc(b.text), toDoc(e.text));
      if (reqs.length) plans.push({ at: b.startIndex, order: 1, requests: reqs });
    } else if (e.op === "remove") {
      same(b, e.oldText);
      const inserts = edits.filter((x): x is Extract<BlockEdit, { op: "insert_after" }> => x.op === "insert_after" && x.key === e.key);
      const replacement = inserts.flatMap((x) => x.paragraphs).map(toDoc);
      if (replacement.length) {
        // Removed but with new paragraphs after it: the new text takes its place.
        const text = replacement.join("\n");
        const reqs = rewrite(b.startIndex, toDoc(b.text), text);
        reqs.push(...tidyNew(b.startIndex, text.length, b));
        plans.push({ at: b.startIndex, order: 1, requests: reqs });
      } else if (b.removable) {
        plans.push({ at: b.startIndex, order: 1, requests: [{ deleteContentRange: { range: { startIndex: b.startIndex, endIndex: b.endIndex } } }] });
      } else if (b.endIndex - 1 > b.startIndex) {
        // The last paragraph of a cell / the doc: empty it instead.
        plans.push({ at: b.startIndex, order: 1, requests: [{ deleteContentRange: { range: { startIndex: b.startIndex, endIndex: b.endIndex - 1 } } }] });
      }
    } else {
      if (removed.has(e.key)) continue; // folded into the remove above
      if (!b.editable) throw new BlockEditError("New text can't be added right after an image or signature — pick a text paragraph.");
      const paras = e.paragraphs.map(toDoc);
      if (!paras.length) continue;
      const text = "\n" + paras.join("\n");
      const at = b.endIndex - 1;
      plans.push({
        at,
        order: 2,
        requests: [{ insertText: { location: { index: at }, text } }, ...tidyNew(at + 1, text.length - 1, b)],
      });
    }
  }

  // Last position first; at one position, the insert-after (end of a
  // paragraph) before any rewrite of that same paragraph's text.
  plans.sort((x, y) => y.at - x.at || y.order - x.order);
  return plans.flatMap((p) => p.requests);
}

/** The first editable paragraph whose text contains `needle` (e.g. "$1,200.00"). */
export function findBlockContaining(blocks: DocBlock[], needle: string): DocBlock | null {
  if (!needle) return null;
  return blocks.find((b) => b.editable && b.text.includes(needle)) ?? null;
}

/**
 * For a template with no {{payment_terms}} token: the edit that puts the
 * payment terms right after the first paragraph quoting the one-time price
 * (in a bulleted list, as one bullet with line breaks; elsewhere, one
 * paragraph per line). Null when no paragraph mentions the price.
 */
export function placePaymentTerms(blocks: DocBlock[], plan: PaymentPlan | null, oneTimePrice: number | null): BlockEdit | null {
  if (oneTimePrice === null) return null;
  const anchor = findBlockContaining(blocks, formatUsd(oneTimePrice));
  if (!anchor) return null;
  const lines = paymentTermsText(plan, oneTimePrice).split("\n");
  return { op: "insert_after", key: anchor.key, paragraphs: anchor.bullet ? [lines.join("\n")] : lines };
}
