// tests/siteAgentDiff.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { lineDiff } from "@/lib/site-agent/diff";

describe("lineDiff", () => {
  it("marks unchanged, added, and removed lines", () => {
    expect(lineDiff("a\nb\nc", "a\nx\nc")).toEqual([
      { type: "same", text: "a" }, { type: "del", text: "b" },
      { type: "add", text: "x" }, { type: "same", text: "c" },
    ]);
  });
  it("pure insertion and pure deletion", () => {
    expect(lineDiff("a", "a\nb")).toEqual([{ type: "same", text: "a" }, { type: "add", text: "b" }]);
    expect(lineDiff("a\nb", "a")).toEqual([{ type: "same", text: "a" }, { type: "del", text: "b" }]);
  });
  it("null sides render as all-add / all-del (created and deleted files)", () => {
    expect(lineDiff(null, "a\nb")).toEqual([{ type: "add", text: "a" }, { type: "add", text: "b" }]);
    expect(lineDiff("a", null)).toEqual([{ type: "del", text: "a" }]);
  });
  it("identical input is all-same and does not blow up on big-ish files", () => {
    const big = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join("\n");
    const out = lineDiff(big, big);
    expect(out).toHaveLength(3000);
    expect(out.every((o) => o.type === "same")).toBe(true);
  });
  it("treats CRLF vs LF as identical content, not a full-file rewrite", () => {
    const out = lineDiff("a\r\nb\r\nc", "a\nb\nc");
    expect(out).toEqual([
      { type: "same", text: "a" }, { type: "same", text: "b" }, { type: "same", text: "c" },
    ]);
  });
  it("empty-side inputs take the trivial path (created/deleted files of any size)", () => {
    const big = Array.from({ length: 5000 }, (_, i) => `l${i}`).join("\n");
    const del = lineDiff(big, null);
    expect(del).toHaveLength(5000);
    expect(del.every((o) => o.type === "del")).toBe(true);
    expect(lineDiff(null, "x")).toEqual([{ type: "add", text: "x" }]);
  });
  it("empty string is one empty line, distinct from null", () => {
    expect(lineDiff("", null)).toEqual([{ type: "del", text: "" }]);
    expect(lineDiff("", "")).toEqual([{ type: "same", text: "" }]);
  });
});
