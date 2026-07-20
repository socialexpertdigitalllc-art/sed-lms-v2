import { describe, it, expect } from "vitest";
import {
  MAX_COLORS,
  colorToHex,
  deterministicIssues,
  formatColorScheme,
  isLikelyColor,
  normalizeHex,
  parseColorScheme,
} from "@/lib/leads/colorScheme";

describe("normalizeHex", () => {
  it("expands 3-digit hex", () => {
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
  });

  it("tolerates a missing #", () => {
    expect(normalizeHex("1A73E8")).toBe("#1a73e8");
    expect(normalizeHex("fff")).toBe("#ffffff");
  });

  it("passes 6-digit hex through, lowercased", () => {
    expect(normalizeHex("#1A73E8")).toBe("#1a73e8");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeHex("  #000  ")).toBe("#000000");
  });

  it("returns null for non-hex", () => {
    expect(normalizeHex("navy")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("#zzzzzz")).toBeNull();
    expect(normalizeHex("")).toBeNull();
  });
});

describe("isLikelyColor", () => {
  it("accepts hex, rgb and known names", () => {
    expect(isLikelyColor("#0d9488")).toBe(true);
    expect(isLikelyColor("0d9488")).toBe(true);
    expect(isLikelyColor("rgb(12, 34, 56)")).toBe(true);
    expect(isLikelyColor("rgba(12, 34, 56, 0.5)")).toBe(true);
    expect(isLikelyColor("Navy")).toBe(true);
    expect(isLikelyColor("off white")).toBe(true);
  });

  it("rejects vague and non-colour input", () => {
    expect(isLikelyColor("same as logo")).toBe(false);
    expect(isLikelyColor("up to you")).toBe(false);
    expect(isLikelyColor("professional")).toBe(false);
    expect(isLikelyColor("whatever")).toBe(false);
    expect(isLikelyColor("")).toBe(false);
  });
});

describe("colorToHex", () => {
  it("resolves names and hex, and gives up on the rest", () => {
    expect(colorToHex("navy")).toBe("#000080");
    expect(colorToHex("#abc")).toBe("#aabbcc");
    expect(colorToHex("up to us")).toBeNull();
  });
});

describe("parseColorScheme", () => {
  it("splits on commas, slashes, semicolons, ampersands, 'and' and newlines", () => {
    expect(parseColorScheme("navy, gold")).toEqual(["navy", "gold"]);
    expect(parseColorScheme("navy/gold")).toEqual(["navy", "gold"]);
    expect(parseColorScheme("navy; gold")).toEqual(["navy", "gold"]);
    expect(parseColorScheme("navy & gold")).toEqual(["navy", "gold"]);
    expect(parseColorScheme("navy and gold")).toEqual(["navy", "gold"]);
    expect(parseColorScheme("navy\ngold")).toEqual(["navy", "gold"]);
  });

  it("does not split the 'and' inside a word", () => {
    expect(parseColorScheme("sand")).toEqual(["sand"]);
  });

  it("preserves order and drops empties", () => {
    expect(parseColorScheme(" red ,, blue , ")).toEqual(["red", "blue"]);
  });

  it("de-dupes case-insensitively and across hex forms", () => {
    expect(parseColorScheme("Navy, navy, NAVY")).toEqual(["Navy"]);
    expect(parseColorScheme("#FFF, #ffffff")).toEqual(["#FFF"]);
  });

  it("keeps separators inside brackets intact", () => {
    expect(parseColorScheme("rgb(12, 34, 56), navy")).toEqual(["rgb(12, 34, 56)", "navy"]);
  });

  it("returns [] for empty input", () => {
    expect(parseColorScheme("")).toEqual([]);
    expect(parseColorScheme("   ")).toEqual([]);
  });
});

describe("formatColorScheme", () => {
  it("comma-joins and normalises hex, keeping names as typed", () => {
    expect(formatColorScheme(["#ABC", "navy"])).toBe("#aabbcc, navy");
  });

  it("drops blanks and duplicates", () => {
    expect(formatColorScheme(["#fff", " ", "#FFFFFF", "navy"])).toBe("#ffffff, navy");
  });

  it("round-trips through parseColorScheme", () => {
    expect(formatColorScheme(parseColorScheme("#ABC / navy"))).toBe("#aabbcc, navy");
  });
});

describe("deterministicIssues", () => {
  it("faults an empty scheme", () => {
    expect(deterministicIssues("")).toHaveLength(1);
    expect(deterministicIssues("   ")[0]).toMatch(/required/i);
  });

  it("faults more than MAX_COLORS entries", () => {
    const issues = deterministicIssues("red, blue, green, gold");
    expect(issues.some((i) => i.includes(String(MAX_COLORS)))).toBe(true);
  });

  it("faults entries that are clearly not colours", () => {
    const issues = deterministicIssues("same as logo");
    expect(issues.join(" ")).toMatch(/not recognisable/i);
  });

  it("passes a clean 3-colour scheme", () => {
    expect(deterministicIssues("#1a73e8, #ffffff, navy")).toEqual([]);
  });

  it("passes a single colour", () => {
    expect(deterministicIssues("navy")).toEqual([]);
  });
});
