import { describe, it, expect } from "vitest";
import { applyOrder } from "@/lib/dashboard/orderCards";

const items = [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }];
const keys = (arr: { key: string }[]) => arr.map((i) => i.key);

describe("applyOrder", () => {
  it("puts items matching the order array first, in that order", () => {
    expect(keys(applyOrder(items, ["c", "a"]))).toEqual(["c", "a", "b", "d"]);
  });

  it("appends unknown/new keys after ordered ones, in their default order", () => {
    expect(keys(applyOrder(items, ["d", "b"]))).toEqual(["d", "b", "a", "c"]);
  });

  it("returns the original order when the order array is empty", () => {
    expect(keys(applyOrder(items, []))).toEqual(["a", "b", "c", "d"]);
  });

  it("applies a full reorder", () => {
    expect(keys(applyOrder(items, ["d", "c", "b", "a"]))).toEqual(["d", "c", "b", "a"]);
  });

  it("gracefully ignores order keys that match no item (hidden/removed cards)", () => {
    expect(keys(applyOrder(items, ["x", "b", "y", "a"]))).toEqual(["b", "a", "c", "d"]);
    expect(keys(applyOrder(items, ["ghost", "phantom"]))).toEqual(["a", "b", "c", "d"]);
  });

  it("handles an empty items array", () => {
    expect(applyOrder([], ["a", "b"])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [{ key: "a" }, { key: "b" }];
    applyOrder(input, ["b", "a"]);
    expect(keys(input)).toEqual(["a", "b"]);
  });

  it("preserves extra item properties", () => {
    const rich = [
      { key: "a", label: "A" },
      { key: "b", label: "B" },
    ];
    expect(applyOrder(rich, ["b"])[0]).toEqual({ key: "b", label: "B" });
  });
});
