import { expect } from "vitest";

/**
 * A tiny model of a Google Doc for contract-editing tests: `makeDoc` builds the
 * Docs API body for some paragraphs, `applyDocRequests` applies batchUpdate
 * requests to the doc's text exactly as Docs counts indices (index 0 is the
 * section break; each paragraph ends in "\n"; the final newline is fixed).
 */

export type FakePara = string | { text: string; style?: string; bullet?: boolean; image?: boolean };

export function makeDoc(paras: FakePara[]) {
  let idx = 1;
  const content: unknown[] = [{ endIndex: 1, sectionBreak: {} }];
  for (const p of paras) {
    const o = typeof p === "string" ? { text: p } : p;
    const t = o.text + "\n";
    const len = t.length + (o.image ? 1 : 0);
    const elements = o.image
      ? [
          { startIndex: idx, endIndex: idx + o.text.length, textRun: { content: o.text } },
          { startIndex: idx + o.text.length, endIndex: idx + o.text.length + 1, inlineObjectElement: { inlineObjectId: "img" } },
          { startIndex: idx + o.text.length + 1, endIndex: idx + len, textRun: { content: "\n" } },
        ]
      : [{ startIndex: idx, endIndex: idx + len, textRun: { content: t } }];
    content.push({
      startIndex: idx,
      endIndex: idx + len,
      paragraph: { elements, paragraphStyle: { namedStyleType: o.style ?? "NORMAL_TEXT" }, ...(o.bullet ? { bullet: { listId: "l1" } } : {}) },
    });
    idx += len;
  }
  return { content };
}

type Req = Record<string, { range?: { startIndex: number; endIndex: number }; location?: { index: number }; text?: string }>;

/** Apply requests to plain-text paragraphs (no images); returns the new paragraphs. */
export function applyDocRequests(paras: string[], requests: unknown[]): { paras: string[]; styled: [number, number][] } {
  let text = "\u0000" + paras.map((p) => p + "\n").join("");
  const styled: [number, number][] = [];
  for (const r of requests as Req[]) {
    if (r.insertText) {
      const at = r.insertText.location!.index;
      expect(at).toBeGreaterThanOrEqual(1);
      expect(at).toBeLessThan(text.length); // never after the doc's final newline
      text = text.slice(0, at) + r.insertText.text + text.slice(at);
    } else if (r.deleteContentRange) {
      const { startIndex: s, endIndex: e } = r.deleteContentRange.range!;
      expect(s).toBeGreaterThanOrEqual(1);
      expect(e).toBeLessThan(text.length); // the final newline can't be deleted
      expect(e).toBeGreaterThan(s);
      text = text.slice(0, s) + text.slice(e);
    } else {
      const range = (r.updateTextStyle ?? r.updateParagraphStyle)!.range!;
      expect(range.endIndex).toBeLessThanOrEqual(text.length);
      styled.push([range.startIndex, range.endIndex]);
    }
  }
  return { paras: text.slice(1).split("\n").slice(0, -1), styled };
}
