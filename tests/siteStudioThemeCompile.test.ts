import { describe, it, expect } from "vitest";
import { extractTheme, isNeutralHex } from "@/lib/site-studio/compiler/theme";
import { fixtureFiles } from "./helpers/siteStudioFixtures";

describe("isNeutralHex", () => {
  it("flags near-black, near-white and grey; keeps saturated colors", () => {
    expect(isNeutralHex("#222222")).toBe(true);
    expect(isNeutralHex("#fafafa")).toBe(true);
    expect(isNeutralHex("#888888")).toBe(true);
    expect(isNeutralHex("#0a5adf")).toBe(false);
    expect(isNeutralHex("#b4540a")).toBe(false);
  });
});

describe("extractTheme", () => {
  it("plumberpro: css_vars mode, roles ranked by var() usage", () => {
    const { theme } = extractTheme(fixtureFiles("plumberpro"));
    expect(theme.mode).toBe("css_vars");
    expect(theme.roles.brand).toEqual({ var: "--primary", hex: "#0a5adf" });
    expect(theme.roles.brand_deep).toEqual({ var: "--primary-dark", hex: "#063a91" });
    expect(theme.roles.accent).toEqual({ var: "--highlight", hex: "#ff9f1c" });
  });
  it("bakery: literal_remap mode from hex frequency, neutrals excluded", () => {
    const { theme } = extractTheme(fixtureFiles("bakery"));
    expect(theme.mode).toBe("literal_remap");
    expect(theme.roles.brand.hex).toBe("#b4540a");
    expect(Object.values(theme.roles).map((r) => r.hex)).not.toContain("#333333");
  });
  it("no colors at all: mode none with info diagnostic", () => {
    const { theme, diagnostics } = extractTheme({ "style.css": new TextEncoder().encode("body{font-size:14px}") });
    expect(theme.mode).toBe("none");
    expect(diagnostics.some((d) => d.code === "theme_none")).toBe(true);
  });
});
