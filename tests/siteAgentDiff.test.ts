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
});
