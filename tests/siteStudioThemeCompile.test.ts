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
  it("dedupes duplicate custom-property declarations by name (media-query override)", () => {
    const css = `
      :root { --primary: #0a5adf; --accent: #ff9f1c; }
      @media (prefers-color-scheme: dark) {
        :root { --primary: #063a91; }
      }
      h1 { color: var(--primary); }
      h2 { color: var(--primary); }
      .card { color: var(--accent); }
    `;
    const { theme } = extractTheme({ "style.css": new TextEncoder().encode(css) });
    expect(theme.mode).toBe("css_vars");
    expect(theme.roles.brand).toEqual({ var: "--primary", hex: "#0a5adf" });
    expect(theme.roles.brand_deep).toEqual({ var: "--accent", hex: "#ff9f1c" });
    const vars = Object.values(theme.roles).map((r) => r.var);
    expect(new Set(vars).size).toBe(vars.length);
  });
  it("rejects 4-digit hex tokens (RGBA-ish) so they cannot outrank real colors", () => {
    const css = `
      .overlay1 { background: #0006; }
      .overlay2 { background: #0006; }
      .overlay3 { background: #0006; }
      h1 { color: #b4540a; }
    `;
    const { theme } = extractTheme({ "style.css": new TextEncoder().encode(css) });
    expect(theme.mode).toBe("literal_remap");
    expect(theme.roles.brand.hex).toBe("#b4540a");
    expect(Object.values(theme.roles).map((r) => r.hex)).not.toContain("#0006");
  });
  it("strips CSS comments before scanning so commented-out palettes don't rank", () => {
    const css = `
      /* draft palette: #ff0000 #ff0000 #ff0000 */
      h1 { color: #b4540a; }
    `;
    const { theme } = extractTheme({ "style.css": new TextEncoder().encode(css) });
    expect(theme.mode).toBe("literal_remap");
    expect(theme.roles.brand.hex).toBe("#b4540a");
    expect(Object.values(theme.roles).map((r) => r.hex)).not.toContain("#ff0000");
  });
  it("strips url() contents before scanning so SVG fragment ids don't rank as colors", () => {
    const css = `
      .icon { filter: url(#fade00); }
      .icon2 { filter: url(#fade00); }
      .icon3 { filter: url(#fade00); }
      h1 { color: #b4540a; }
    `;
    const { theme } = extractTheme({ "style.css": new TextEncoder().encode(css) });
    expect(theme.mode).toBe("literal_remap");
    expect(theme.roles.brand.hex).toBe("#b4540a");
    expect(Object.values(theme.roles).map((r) => r.hex)).not.toContain("#fade00");
  });
  it("counts var() fallback syntax as a use, ranking above a declared-but-unused var", () => {
    const css = `
      :root { --secondary: #063a91; --primary: #0a5adf; }
      h1 { color: var(--primary, #ffffff); }
    `;
    const { theme } = extractTheme({ "style.css": new TextEncoder().encode(css) });
    expect(theme.mode).toBe("css_vars");
    expect(theme.roles.brand).toEqual({ var: "--primary", hex: "#0a5adf" });
  });
});
