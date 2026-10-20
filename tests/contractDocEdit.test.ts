import { describe, it, expect } from "vitest";
import {
  docToBlocks,
  buildEditRequests,
  diffMiddle,
  placePaymentTerms,
  BlockEditError,
  type BlockEdit,
} from "@/lib/contracts/docEdit";
import { depositAndBalance } from "@/lib/contracts/payments";
import { makeDoc, applyDocRequests, type FakePara } from "./helpers/fakeDocs";

/**
 * Editing a contract's Google Doc from the dashboard. A tiny model of the
 * Docs API applies the generated requests to the doc's text, so these tests
 * check the index arithmetic end to end, not just the request shapes.
 */

type P = FakePara;
const apply = applyDocRequests;

const PARAS = [
  "WEBSITE DEVELOPMENT AGREEMENT",
  "Fee: $1,200.00 (USD) / One Time",
  "Payments are non-refundable once work has commenced.",
  "Either party may terminate with written notice.",
];

const run = (paras: string[], edits: BlockEdit[]) => {
  const blocks = docToBlocks(makeDoc(paras));
  return apply(paras, buildEditRequests(blocks, edits));
};
const keyOf = (paras: P[], i: number) => docToBlocks(makeDoc(paras))[i].key;

describe("docToBlocks", () => {
  it("lists paragraphs with their positions, style and flags", () => {
    const blocks = docToBlocks(makeDoc([{ text: "TITLE", style: "HEADING_1" }, { text: "Item", bullet: true }, "Last"]));
    expect(blocks).toEqual([
      expect.objectContaining({ key: "1", startIndex: 1, endIndex: 7, text: "TITLE", style: "HEADING_1", bullet: false, editable: true, removable: true }),
      expect.objectContaining({ key: "7", startIndex: 7, endIndex: 12, text: "Item", bullet: true, removable: true }),
      expect.objectContaining({ key: "12", text: "Last", removable: false }), // the doc's last paragraph
    ]);
  });

  it("an image or signature paragraph is read-only", () => {
    const [b] = docToBlocks(makeDoc([{ text: "Signed: ", image: true }, "x"]));
    expect(b.editable).toBe(false);
  });

  it("shows soft line breaks as new lines", () => {
    const [b] = docToBlocks(makeDoc(["Line one\u000bLine two", "x"]));
    expect(b.text).toBe("Line one\nLine two");
  });

  it("walks table cells; a cell's last paragraph can't be removed", () => {
    const cell = (start: number, text: string) => ({
      endIndex: start + 1 + text.length + 1,
      content: [{ startIndex: start + 1, endIndex: start + 2 + text.length, paragraph: { elements: [{ textRun: { content: text + "\n" } }] } }],
    });
    const body = {
      content: [
        { endIndex: 1, sectionBreak: {} },
        { startIndex: 1, endIndex: 7, paragraph: { elements: [{ textRun: { content: "Above\n" } }] } },
        { startIndex: 7, endIndex: 20, table: { tableRows: [{ tableCells: [{ ...cell(8, "Cell") }] }] } },
        { startIndex: 20, endIndex: 26, paragraph: { elements: [{ textRun: { content: "Below\n" } }] } },
      ],
    };
    const blocks = docToBlocks(body);
    expect(blocks.map((b) => [b.text, b.inTable, b.removable])).toEqual([
      ["Above", false, false], // right before a table — its newline is structural
      ["Cell", true, false],
      ["Below", false, false],
    ]);
  });
});

describe("buildEditRequests — applied to the doc", () => {
  it("rewords a price, touching only the changed characters", () => {
    const blocks = docToBlocks(makeDoc(PARAS));
    const reqs = buildEditRequests(blocks, [{ op: "replace", key: blocks[1].key, oldText: PARAS[1], text: "Fee: $1,000.00 (USD) / One Time" }]);
    expect(reqs).toEqual([
      { deleteContentRange: { range: { startIndex: blocks[1].startIndex + 8, endIndex: blocks[1].startIndex + 9 } } },
      { insertText: { location: { index: blocks[1].startIndex + 8 }, text: "0" } },
    ]);
    expect(apply(PARAS, reqs).paras[1]).toBe("Fee: $1,000.00 (USD) / One Time");
  });

  it("removes a paragraph", () => {
    const out = run(PARAS, [{ op: "remove", key: keyOf(PARAS, 2), oldText: PARAS[2] }]);
    expect(out.paras).toEqual([PARAS[0], PARAS[1], PARAS[3]]);
  });

  it("the doc's last paragraph is emptied, not deleted", () => {
    const out = run(PARAS, [{ op: "remove", key: keyOf(PARAS, 3), oldText: PARAS[3] }]);
    expect(out.paras).toEqual([PARAS[0], PARAS[1], PARAS[2], ""]);
  });

  it("adds paragraphs after one, as plain body text", () => {
    const blocks = docToBlocks(makeDoc(PARAS));
    const reqs = buildEditRequests(blocks, [{ op: "insert_after", key: blocks[1].key, paragraphs: ["Deposit: $600.00", "Balance: $600.00"] }]);
    expect(apply(PARAS, reqs).paras).toEqual([PARAS[0], PARAS[1], "Deposit: $600.00", "Balance: $600.00", PARAS[2], PARAS[3]]);
    // Inherited bold/italic/underline cleared on exactly the new text.
    const style = reqs.find((r) => "updateTextStyle" in (r as object)) as { updateTextStyle: { range: { startIndex: number; endIndex: number } } };
    const start = blocks[1].endIndex;
    expect(style.updateTextStyle.range).toEqual({ startIndex: start, endIndex: start + "Deposit: $600.00\nBalance: $600.00".length });
  });

  it("a paragraph added after a heading is not itself a heading", () => {
    const paras: P[] = [{ text: "1. Pricing", style: "HEADING_2" }, "x"];
    const reqs = buildEditRequests(docToBlocks(makeDoc(paras)), [{ op: "insert_after", key: "1", paragraphs: ["New clause"] }]);
    expect(reqs).toContainEqual(expect.objectContaining({ updateParagraphStyle: expect.objectContaining({ paragraphStyle: { namedStyleType: "NORMAL_TEXT" } }) }));
  });

  it("many edits across the doc land where they were made", () => {
    const k = (i: number) => keyOf(PARAS, i);
    const out = run(PARAS, [
      { op: "replace", key: k(0), oldText: PARAS[0], text: "WEBSITE & SEO AGREEMENT" },
      { op: "insert_after", key: k(1), paragraphs: ["Deposit due upon signing."] },
      { op: "replace", key: k(1), oldText: PARAS[1], text: "Fee: $900.00 (USD) / One Time" },
      { op: "remove", key: k(2), oldText: PARAS[2] },
      { op: "replace", key: k(3), oldText: PARAS[3], text: "Either party may end this with 7 days' written notice." },
    ]);
    expect(out.paras).toEqual([
      "WEBSITE & SEO AGREEMENT",
      "Fee: $900.00 (USD) / One Time",
      "Deposit due upon signing.",
      "Either party may end this with 7 days' written notice.",
    ]);
  });

  it("remove + add after the same paragraph = its text replaced", () => {
    const out = run(PARAS, [
      { op: "remove", key: keyOf(PARAS, 2), oldText: PARAS[2] },
      { op: "insert_after", key: keyOf(PARAS, 2), paragraphs: ["A deposit is non-refundable.", "The balance is due at launch."] },
    ]);
    expect(out.paras).toEqual([PARAS[0], PARAS[1], "A deposit is non-refundable.", "The balance is due at launch.", PARAS[3]]);
  });

  it("a line break typed inside a paragraph stays one paragraph", () => {
    const blocks = docToBlocks(makeDoc(PARAS));
    const reqs = buildEditRequests(blocks, [{ op: "replace", key: blocks[2].key, oldText: PARAS[2], text: "Payments are non-refundable\nonce work has commenced." }]);
    const out = apply(PARAS, reqs);
    expect(out.paras).toHaveLength(4);
    expect(out.paras[2]).toBe("Payments are non-refundable\u000bonce work has commenced.");
  });

  it("counts characters the way Docs does (UTF-16), emoji included", () => {
    const paras = ["Price 💲 $100 today", "x"];
    const out = run(paras, [{ op: "replace", key: "1", oldText: paras[0], text: "Price 💲 $150 today" }]);
    expect(out.paras[0]).toBe("Price 💲 $150 today");
  });

  it("nothing changed → no requests", () => {
    const blocks = docToBlocks(makeDoc(PARAS));
    expect(buildEditRequests(blocks, [{ op: "replace", key: blocks[1].key, oldText: PARAS[1], text: PARAS[1] }])).toEqual([]);
  });

  it("refuses edits made against older text, unknown paragraphs and images", () => {
    const blocks = docToBlocks(makeDoc([...PARAS, { text: "Sig ", image: true }, "end"]));
    expect(() => buildEditRequests(blocks, [{ op: "replace", key: blocks[1].key, oldText: "Fee: $999", text: "x" }])).toThrow(BlockEditError);
    expect(() => buildEditRequests(blocks, [{ op: "remove", key: "9999", oldText: "" }])).toThrow(/no longer in the contract/);
    expect(() => buildEditRequests(blocks, [{ op: "replace", key: blocks[4].key, oldText: blocks[4].text, text: "x" }])).toThrow(/image or signature/);
  });
});

describe("diffMiddle", () => {
  it("finds the smallest changed span", () => {
    expect(diffMiddle("abcXdef", "abcYYdef")).toEqual({ from: 3, oldEnd: 4, insert: "YY" });
    expect(diffMiddle("aaa", "aaaa")).toEqual({ from: 3, oldEnd: 3, insert: "a" });
    expect(diffMiddle("same", "same")).toEqual({ from: 4, oldEnd: 4, insert: "" });
  });
});

describe("placePaymentTerms — a template without {{payment_terms}}", () => {
  it("goes after the paragraph quoting the price, one paragraph per line", () => {
    const blocks = docToBlocks(makeDoc(PARAS));
    const edit = placePaymentTerms(blocks, depositAndBalance(1200, 600), 1200)!;
    const out = apply(PARAS, buildEditRequests(blocks, [edit]));
    expect(out.paras.slice(1, 5)).toEqual([
      PARAS[1],
      expect.stringMatching(/^The one-time fee of \$1,200\.00 will be paid in two parts/),
      "1. $600.00 (Deposit) — due upon signing this agreement",
      "2. $600.00 (Balance) — due when work on the project begins",
    ]);
  });

  it("in a bulleted list it is one bullet with line breaks", () => {
    const paras: P[] = ["Pricing", { text: "Fee: $1,200.00 (USD) / One Time", bullet: true }, "x"];
    const edit = placePaymentTerms(docToBlocks(makeDoc(paras)), depositAndBalance(1200, 600), 1200);
    expect(edit).toMatchObject({ op: "insert_after", key: keyOf(paras, 1) });
    expect((edit as { paragraphs: string[] }).paragraphs).toHaveLength(1);
  });

  it("no paragraph mentions the price → null (the agent places it)", () => {
    expect(placePaymentTerms(docToBlocks(makeDoc(["Nothing priced here", "x"])), depositAndBalance(1200, 600), 1200)).toBeNull();
  });
});
