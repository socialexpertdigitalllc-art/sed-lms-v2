import { describe, it, expect } from "vitest";
import { toggleTag, leadMatchesTags } from "@/lib/leads/tagFilter";
import { tagColor, TAG_COLORS, TAG_COLOR_KEYS } from "@/lib/leads/tagColors";

describe("toggleTag", () => {
  it("adds an id when absent", () => {
    expect(toggleTag(["a"], "b")).toEqual(["a", "b"]);
  });
  it("removes an id when present", () => {
    expect(toggleTag(["a", "b"], "a")).toEqual(["b"]);
  });
  it("does not mutate the input array", () => {
    const src = ["a"];
    toggleTag(src, "b");
    expect(src).toEqual(["a"]);
  });
  it("round-trips back to the original set", () => {
    expect(toggleTag(toggleTag(["a"], "b"), "b")).toEqual(["a"]);
  });
});

describe("leadMatchesTags", () => {
  it("matches every lead when no tags are selected", () => {
    expect(leadMatchesTags(["x"], [])).toBe(true);
    expect(leadMatchesTags([], [])).toBe(true);
    expect(leadMatchesTags(null, [])).toBe(true);
    expect(leadMatchesTags(undefined, [])).toBe(true);
  });
  it("matches on any overlap (OR semantics)", () => {
    expect(leadMatchesTags(["a", "b"], ["b", "c"])).toBe(true);
    expect(leadMatchesTags(["a"], ["a"])).toBe(true);
  });
  it("does not match when the lead's tags are disjoint from the filter", () => {
    expect(leadMatchesTags(["a"], ["b"])).toBe(false);
  });
  it("does not match a lead with no tags once a filter is set", () => {
    expect(leadMatchesTags([], ["a"])).toBe(false);
    expect(leadMatchesTags(null, ["a"])).toBe(false);
    expect(leadMatchesTags(undefined, ["a"])).toBe(false);
  });
});

describe("tagColor", () => {
  it("returns the requested color definition", () => {
    expect(tagColor("blue")).toBe(TAG_COLORS.blue);
  });
  it("falls back to slate for unknown/empty/null keys", () => {
    expect(tagColor("nope")).toBe(TAG_COLORS.slate);
    expect(tagColor("")).toBe(TAG_COLORS.slate);
    expect(tagColor(null)).toBe(TAG_COLORS.slate);
    expect(tagColor(undefined)).toBe(TAG_COLORS.slate);
  });
  it("exposes exactly 8 named colors including slate", () => {
    expect(TAG_COLOR_KEYS).toHaveLength(8);
    expect(TAG_COLOR_KEYS).toContain("slate");
    expect(TAG_COLOR_KEYS).toEqual(["slate", "red", "amber", "green", "teal", "blue", "purple", "pink"]);
  });
});
