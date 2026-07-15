import { describe, it, expect } from "vitest";
import { toggleTag, leadMatchesTags, ownTags, canApplyTag, buildTagLinkRows } from "@/lib/leads/tagFilter";
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

describe("canApplyTag", () => {
  it("is true only for the caller's own tag", () => {
    expect(canApplyTag({ owner_id: "u1" }, "u1")).toBe(true);
    expect(canApplyTag({ owner_id: "u2" }, "u1")).toBe(false);
  });
  it("is false for an empty/mismatched user id", () => {
    expect(canApplyTag({ owner_id: "u1" }, "")).toBe(false);
  });
});

describe("ownTags", () => {
  const tags = [
    { id: "a", name: "A", color: "red", owner_id: "u1" },
    { id: "b", name: "B", color: "blue", owner_id: "u2" },
    { id: "c", name: "C", color: "teal", owner_id: "u1" },
  ];
  it("returns only the tags owned by the given user", () => {
    expect(ownTags(tags, "u1").map((t) => t.id)).toEqual(["a", "c"]);
    expect(ownTags(tags, "u2").map((t) => t.id)).toEqual(["b"]);
  });
  it("returns an empty array when the user owns none", () => {
    expect(ownTags(tags, "u3")).toEqual([]);
    expect(ownTags(tags, "")).toEqual([]);
  });
  it("does not mutate the input array", () => {
    const src = [...tags];
    ownTags(tags, "u1");
    expect(tags).toEqual(src);
  });
});

describe("buildTagLinkRows", () => {
  it("builds the cartesian product of leads × tags", () => {
    expect(buildTagLinkRows(["L1", "L2"], ["t1", "t2"], "u1")).toEqual([
      { lead_id: "L1", tag_id: "t1", added_by: "u1" },
      { lead_id: "L1", tag_id: "t2", added_by: "u1" },
      { lead_id: "L2", tag_id: "t1", added_by: "u1" },
      { lead_id: "L2", tag_id: "t2", added_by: "u1" },
    ]);
  });
  it("dedupes repeated lead and tag ids", () => {
    expect(buildTagLinkRows(["L1", "L1"], ["t1", "t1"], "u1")).toEqual([
      { lead_id: "L1", tag_id: "t1", added_by: "u1" },
    ]);
  });
  it("stamps every row's added_by with the given user id", () => {
    const rows = buildTagLinkRows(["L1", "L2"], ["t1"], "u9");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.added_by === "u9")).toBe(true);
  });
  it("returns an empty array when either list is empty", () => {
    expect(buildTagLinkRows([], ["t1"], "u1")).toEqual([]);
    expect(buildTagLinkRows(["L1"], [], "u1")).toEqual([]);
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
