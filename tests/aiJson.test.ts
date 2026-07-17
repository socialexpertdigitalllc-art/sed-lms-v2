import { describe, it, expect } from "vitest";
import { parseJsonLoose, parseJsonArrayPrefix } from "@/lib/ai/json";

describe("parseJsonLoose", () => {
  it("parses plain JSON", () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });
  it("strips ```json fences (Gemini's default shape)", () => {
    expect(parseJsonLoose('```json\n{"people":true}\n```')).toEqual({ people: true });
  });
  it("strips bare ``` fences", () => {
    expect(parseJsonLoose('```\n{"a":[1,2]}\n```')).toEqual({ a: [1, 2] });
  });
  it("extracts JSON embedded in prose", () => {
    expect(parseJsonLoose('Here you go:\n{"a":"b"}\nHope that helps!')).toEqual({ a: "b" });
  });
  it("returns null for unparseable input instead of throwing", () => {
    expect(parseJsonLoose("not json at all")).toBeNull();
    expect(parseJsonLoose("")).toBeNull();
  });
  it("prefers the outermost object", () => {
    expect(parseJsonLoose('{"outer":{"inner":1}}')).toEqual({ outer: { inner: 1 } });
  });
});

// These exercise the extraction path specifically: every input here MUST fail
// the fast JSON.parse at the top, so deleting the extraction block fails them.
describe("parseJsonLoose — extraction from prose", () => {
  it("ignores a bracketed prose citation and returns the real object", () => {
    // Regression: the old first-bracket-wins heuristic returned [1] here.
    expect(parseJsonLoose('Image [1] scored:\n{"score":8}')).toEqual({ score: 8 });
  });

  it("ignores a leading reference marker", () => {
    expect(parseJsonLoose('See refs [1] below:\n{"a":1}')).toEqual({ a: 1 });
  });

  it("returns the full outer object when prose-wrapped and nested", () => {
    expect(parseJsonLoose('Result:\n{"outer":{"inner":[1,2]}}\nDone.')).toEqual({
      outer: { inner: [1, 2] },
    });
  });

  it("extracts an array embedded in prose", () => {
    expect(parseJsonLoose('Ranked:\n[{"id":1},{"id":2}]\nThat is all.')).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("ignores trailing prose containing brace-like text", () => {
    expect(parseJsonLoose('{"a":1}\nNote: replace {x} with your name.')).toEqual({ a: 1 });
  });

  it("does not stop at a brace inside a string value", () => {
    expect(parseJsonLoose('Result: {"note":"use } carefully"} end')).toEqual({ note: "use } carefully" });
  });

  it("handles a fenced string value that itself contains a fence", () => {
    expect(parseJsonLoose('```json\n{"code":"``` fenced"}\n```')).toEqual({ code: "``` fenced" });
  });

  it("returns null for truncated JSON rather than a partial value", () => {
    // The exact v1 failure: a capped completion must never parse to something.
    expect(parseJsonLoose('{"a":1,')).toBeNull();
    expect(parseJsonLoose('Here:\n{"a":1,')).toBeNull();
    expect(parseJsonLoose('{"a":[1,2')).toBeNull();
  });

  it("returns the first parseable block when two fences are present", () => {
    // Deliberate: ties on size resolve to the earliest block.
    expect(parseJsonLoose('```json\n{"a":1}\n```\n```json\n{"b":2}\n```')).toEqual({ a: 1 });
  });

  it("skips a bracketed markdown placeholder before a fence", () => {
    expect(parseJsonLoose('- fill in [placeholder]\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});

// Salvage for per-item verdict arrays: unlike parseJsonLoose (whose contract is
// "never return a partial value" — right for content models, where a partial
// payload is dangerous), parseJsonArrayPrefix exists for arrays whose elements
// are independently safe (one vision verdict per image). A truncated response
// yields the complete leading elements instead of nothing.
describe("parseJsonArrayPrefix", () => {
  it("returns all elements of a complete array", () => {
    expect(parseJsonArrayPrefix('[{"a":1},{"b":2}]')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("returns the complete leading elements of an array truncated mid-element", () => {
    // The exact gemini-3.5-flash failure: thinking tokens ate the budget and the
    // verdict array was cut off mid-object with a 200 + finish_reason=length.
    const truncated = '[{"people":false,"relevance":0.4,"quality":0.4,"reason":"blurry"},{"people":true,"relevance":0.7,"qual';
    expect(parseJsonArrayPrefix(truncated)).toEqual([
      { people: false, relevance: 0.4, quality: 0.4, reason: "blurry" },
    ]);
  });

  it("handles an unterminated ```json fence around a truncated array", () => {
    const fencedTruncated = '```json\n[{"a":1},{"b":2},{"c"';
    expect(parseJsonArrayPrefix(fencedTruncated)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("is string-aware: braces and commas inside string values are not element boundaries", () => {
    const truncated = '[{"reason":"shows } and , inside"},{"reason":"cut';
    expect(parseJsonArrayPrefix(truncated)).toEqual([{ reason: "shows } and , inside" }]);
  });

  it("survives an escaped quote before the cut", () => {
    const truncated = '[{"reason":"a \\"quoted\\" word"},{"reason":"x';
    expect(parseJsonArrayPrefix(truncated)).toEqual([{ reason: 'a "quoted" word' }]);
  });

  it("returns [] when no array is present", () => {
    expect(parseJsonArrayPrefix("not json at all")).toEqual([]);
    expect(parseJsonArrayPrefix("")).toEqual([]);
    expect(parseJsonArrayPrefix('{"a":1}')).toEqual([]);
  });

  it("returns [] for an array cut before its first complete element", () => {
    expect(parseJsonArrayPrefix('[{"people":false,"rel')).toEqual([]);
  });

  it("ignores prose before the array", () => {
    expect(parseJsonArrayPrefix('Here are the verdicts:\n[{"a":1},{"b"')).toEqual([{ a: 1 }]);
  });
});
