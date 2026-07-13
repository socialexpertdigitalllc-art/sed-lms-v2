import { describe, it, expect } from "vitest";
import { splitCommaRow } from "@/lib/forms/splitCommaRow";

describe("splitCommaRow", () => {
  it("splits a comma-separated row into trimmed parts spliced at that position", () => {
    expect(splitCommaRow(["a, b , c", "d"], 0)).toEqual(["a", "b", "c", "d"]);
  });

  it("preserves rows before the split index", () => {
    expect(splitCommaRow(["x", "a,b", "y"], 1)).toEqual(["x", "a", "b", "y"]);
  });

  it("returns null when the value has no comma", () => {
    expect(splitCommaRow(["abc", "d"], 0)).toBeNull();
  });

  it("drops empty parts", () => {
    expect(splitCommaRow(["a,,b,", "z"], 0)).toEqual(["a", "b", "z"]);
  });

  it("keeps a single empty string at the position when every part is empty", () => {
    expect(splitCommaRow([",,"], 0)).toEqual([""]);
    expect(splitCommaRow([",,", "d"], 0)).toEqual(["", "d"]);
  });

  it("returns null for an out-of-range index", () => {
    expect(splitCommaRow(["a"], 5)).toBeNull();
  });

  it("returns a new array and does not mutate the input", () => {
    const input = ["a,b"];
    const out = splitCommaRow(input, 0);
    expect(out).toEqual(["a", "b"]);
    expect(input).toEqual(["a,b"]);
  });
});
