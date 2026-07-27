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

/**
 * Phase 4c: css_vars mode is only ever a PARTIAL fix when the same mapped
 * hex ALSO shows up as a literal outside the `:root` block that declares it
 * as a custom property — those spots never see the studio-theme.css
 * override. Nothing told an operator that at review time before this warn
 * existed; the production failure this exists for shipped with zero signal.
 */
describe("extractTheme — theme_literal_colors diagnostic", () => {
  it("warns when a mapped role's hex appears as a literal more than a handful of times outside :root", () => {
    const css = `
      :root { --primary: #0a5adf; }
      .btn { color: #0a5adf; }
      .badge { color: #0a5adf; }
      .tag { color: #0A5ADF; }
      .pill { color: #0a5adf; }
      h1 { color: var(--primary); }
    `;
    const { theme, diagnostics } = extractTheme({ "style.css": new TextEncoder().encode(css) });
    expect(theme.mode).toBe("css_vars");
    const warn = diagnostics.find((d) => d.code === "theme_literal_colors");
    expect(warn).toBeDefined();
    expect(warn?.level).toBe("warn");
    expect(warn?.message).toMatch(/brand/);
    expect(warn?.message).toMatch(/var\(--primary\)/);
  });

  it("does not warn for a one-off literal (below the handful threshold)", () => {
    const css = `
      :root { --primary: #0a5adf; }
      .btn { color: #0a5adf; }
      h1 { color: var(--primary); }
    `;
    const { diagnostics } = extractTheme({ "style.css": new TextEncoder().encode(css) });
    expect(diagnostics.some((d) => d.code === "theme_literal_colors")).toBe(false);
  });

  it("does not count the :root declaration itself toward the literal-outside-root tally", () => {
    // The value ONLY appears inside :root (where it belongs, as the
    // variable's own declaration) — never repeated as a literal elsewhere.
    const css = `:root { --primary: #0a5adf; } h1 { color: var(--primary); }`;
    const { diagnostics } = extractTheme({ "style.css": new TextEncoder().encode(css) });
    expect(diagnostics.some((d) => d.code === "theme_literal_colors")).toBe(false);
  });

  it("counts the 3-digit shorthand of the same color toward the tally, case-insensitively", () => {
    // #112233 is non-neutral (unlike #ffffff/white, which isNeutralHex would
    // exclude from ever becoming a role at all) and has a valid 3-digit
    // shorthand (#123) — each channel's two digits double up.
    const css = `
      :root { --primary: #112233; }
      .a { color: #123; }
      .b { color: #123; }
      .c { color: #112233; }
      .d { color: #112233; }
      h1 { color: var(--primary); }
    `;
    const { diagnostics } = extractTheme({ "style.css": new TextEncoder().encode(css) });
    expect(diagnostics.some((d) => d.code === "theme_literal_colors")).toBe(true);
  });

  it("never fires for literal_remap mode (the diagnostic only applies where a var() exists to switch to)", () => {
    const css = `
      .btn { color: #b4540a; }
      .badge { color: #b4540a; }
      .tag { color: #b4540a; }
      .pill { color: #b4540a; }
    `;
    const { theme, diagnostics } = extractTheme({ "style.css": new TextEncoder().encode(css) });
    expect(theme.mode).toBe("literal_remap");
    expect(diagnostics.some((d) => d.code === "theme_literal_colors")).toBe(false);
  });

  // Phase 4d: a real commercial template writes most of its color as literal
  // hex in inline `style="..."` attributes, not in CSS — exactly the pattern
  // this diagnostic exists to catch. Before this fix the count only ever
  // looked at CSS assets, so that template stayed silent.
  it("warns when a mapped role's hex appears only in inline HTML style attributes (never in CSS)", () => {
    const css = `:root { --primary: #0a5adf; } h1 { color: var(--primary); }`;
    const pages = {
      "index.html": `
        <div style="color:#0a5adf">A</div>
        <div style="color:#0a5adf">B</div>
        <div style="color:#0a5adf">C</div>
        <div style="color:#0a5adf">D</div>
      `,
    };
    const { theme, diagnostics } = extractTheme({ "style.css": new TextEncoder().encode(css) }, pages);
    expect(theme.mode).toBe("css_vars");
    const warn = diagnostics.find((d) => d.code === "theme_literal_colors");
    expect(warn).toBeDefined();
    expect(warn?.message).toMatch(/brand/);
    expect(warn?.message).toMatch(/var\(--primary\)/);
    expect(warn?.message).toMatch(/4 in HTML/);
  });

  it("reports both CSS and HTML counts when a role's hex appears literally in both", () => {
    const css = `
      :root { --primary: #0a5adf; }
      .btn { color: #0a5adf; }
      .badge { color: #0a5adf; }
      h1 { color: var(--primary); }
    `;
    const pages = {
      "index.html": `
        <div style="color:#0a5adf">A</div>
        <div style="color:#0a5adf">B</div>
      `,
    };
    const { diagnostics } = extractTheme({ "style.css": new TextEncoder().encode(css) }, pages);
    const warn = diagnostics.find((d) => d.code === "theme_literal_colors");
    expect(warn).toBeDefined();
    expect(warn?.message).toMatch(/2 in CSS/);
    expect(warn?.message).toMatch(/2 in HTML/);
  });

  it("stays silent when the combined CSS+HTML literal count is at or below the threshold", () => {
    const css = `
      :root { --primary: #0a5adf; }
      .btn { color: #0a5adf; }
      h1 { color: var(--primary); }
    `;
    const pages = {
      "index.html": `<div style="color:#0a5adf">A</div><div style="color:#0a5adf">B</div>`,
    };
    // total = 1 in CSS + 2 in HTML = 3, not > 3
    const { diagnostics } = extractTheme({ "style.css": new TextEncoder().encode(css) }, pages);
    expect(diagnostics.some((d) => d.code === "theme_literal_colors")).toBe(false);
  });

  it("does not count near-miss literals like #0c5aa0-box or #0c5aa0ff in HTML toward the tally", () => {
    const css = `:root { --primary: #0c5aa0; } h1 { color: var(--primary); }`;
    const pages = {
      "index.html": `
        <div data-a="#0c5aa0-box"></div>
        <div data-b="#0c5aa0ff"></div>
        <div data-c="#0c5aa0-box"></div>
        <div data-d="#0c5aa0ff"></div>
        <div data-e="#0c5aa0-box"></div>
      `,
    };
    const { diagnostics } = extractTheme({ "style.css": new TextEncoder().encode(css) }, pages);
    expect(diagnostics.some((d) => d.code === "theme_literal_colors")).toBe(false);
  });
});
