import { describe, it, expect } from "vitest";
import { deriveTheme } from "@/lib/site-studio/run/theme";
import type { ThemeDef } from "@/lib/site-studio/schema";

const twoRoleTheme: ThemeDef = {
  mode: "css_vars",
  roles: {
    brand: { hex: "#111111" },
    brand_deep: { hex: "#222222" },
  },
};

const threeRoleTheme: ThemeDef = {
  mode: "css_vars",
  roles: {
    brand: { hex: "#111111" },
    brand_deep: { hex: "#222222" },
    accent: { hex: "#333333" },
  },
};

const oneRoleTheme: ThemeDef = {
  mode: "css_vars",
  roles: { brand: { hex: "#111111" } },
};

const noRoleTheme: ThemeDef = { mode: "none", roles: {} };

describe("deriveTheme", () => {
  it("assigns hexes found in order to brand, brand_deep, accent", () => {
    expect(deriveTheme("navy #0a2540 and orange #ff7a1a", twoRoleTheme)).toEqual({
      brand: "#0a2540",
      brand_deep: "#ff7a1a",
    });
  });

  it("returns {} when no hex is present - never guesses from colour words", () => {
    expect(deriveTheme("up to us", twoRoleTheme)).toEqual({});
  });

  it("returns {} for a request to match something rather than a colour", () => {
    expect(deriveTheme("match the logo", twoRoleTheme)).toEqual({});
  });

  it("expands a 3-digit hex to 6 digits", () => {
    expect(deriveTheme("#fff", oneRoleTheme)).toEqual({ brand: "#ffffff" });
  });

  it("drops extra hexes once every declared role is assigned", () => {
    expect(deriveTheme("#111111 #222222 #333333 #444444", oneRoleTheme)).toEqual({ brand: "#111111" });
  });

  it("only assigns roles the manifest actually declares", () => {
    expect(deriveTheme("#0a2540 #ff7a1a #00ff00", threeRoleTheme)).toEqual({
      brand: "#0a2540",
      brand_deep: "#ff7a1a",
      accent: "#00ff00",
    });
  });

  it("returns {} when the manifest theme mode is 'none' (no roles to fill)", () => {
    expect(deriveTheme("#0a2540", noRoleTheme)).toEqual({});
  });

  it("returns {} when the lead supplied no colour_scheme text at all", () => {
    expect(deriveTheme(undefined, twoRoleTheme)).toEqual({});
  });

  it("normalises hex casing to lowercase", () => {
    expect(deriveTheme("#0A2540", oneRoleTheme)).toEqual({ brand: "#0a2540" });
  });

  it("ignores non-hex tokens even when hex-adjacent", () => {
    // "abcdef" without a leading # is not a colour reference.
    expect(deriveTheme("brand colour abcdef please", oneRoleTheme)).toEqual({});
  });
});
