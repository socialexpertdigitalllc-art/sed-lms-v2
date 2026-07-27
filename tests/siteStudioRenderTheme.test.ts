import { describe, it, expect } from "vitest";
import { applyTheme, applyThemeToHtml, remapLiteralColorsInText } from "@/lib/site-studio/render/theme";
import type { ThemeDef } from "@/lib/site-studio/schema";

const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const enc = (s: string) => new TextEncoder().encode(s);

/**
 * Phase 4c: a lead's `color_scheme` derived correctly into `doc.theme`, but a
 * real template writes most of its color as LITERALS — `color:#0C5AA0` in an
 * inline `style` attribute, or in a CSS rule that never touches a variable —
 * so the old css_vars-only `:root` override left the site looking untouched.
 * These tests pin the fix: literal retinting runs IN ADDITION TO the
 * variable override, across stylesheets, inline `style` attributes in
 * rendered HTML, and tokenized (.js/.css) text assets.
 */

const cssVarsTheme: ThemeDef = {
  mode: "css_vars",
  roles: { brand: { var: "--brand", hex: "#0C5AA0" }, brand_deep: { var: "--brand-deep", hex: "#F24F24" } },
};

describe("applyTheme (css_vars mode) — literal retint in addition to the variable override", () => {
  it("still emits studio-theme.css overriding the mapped variables", () => {
    const { assets, injectCssFile } = applyTheme({}, cssVarsTheme, { brand: "#123456" });
    expect(injectCssFile).toBe("studio-theme.css");
    expect(dec(assets["studio-theme.css"])).toContain("--brand: #123456;");
  });

  it("replaces a literal occurrence of the role's own demo hex in a CSS asset", () => {
    const assets = { "style.css": enc(`.hero { color: #0C5AA0; border-color: #0c5aa0; }`) };
    const { assets: out } = applyTheme(assets, cssVarsTheme, { brand: "#123456" });
    expect(dec(out["style.css"])).toBe(`.hero { color: #123456; border-color: #123456; }`);
  });

  it("replaces a literal occurrence inside a tokenized .js text asset too", () => {
    const assets = { "site.js": enc(`chart.setColor("#0C5AA0");`) };
    const { assets: out } = applyTheme(assets, cssVarsTheme, { brand: "#123456" });
    expect(dec(out["site.js"])).toBe(`chart.setColor("#123456");`);
  });

  it("leaves a binary/other asset untouched", () => {
    const assets = { "img/logo.png": enc("not-a-real-png-#0C5AA0") };
    const { assets: out } = applyTheme(assets, cssVarsTheme, { brand: "#123456" });
    expect(dec(out["img/logo.png"])).toBe("not-a-real-png-#0C5AA0");
  });

  it("a color the template uses that is NOT a mapped role hex is left alone", () => {
    const assets = { "style.css": enc(`.hero { color: #0C5AA0; } .footer { color: #999999; }`) };
    const { assets: out } = applyTheme(assets, cssVarsTheme, { brand: "#123456" });
    expect(dec(out["style.css"])).toContain("#999999");
    expect(dec(out["style.css"])).not.toContain("#0C5AA0");
  });
});

describe("remapLiteralColorsInText — matching rule and boundary cases", () => {
  const entries: [string, string][] = [["brand", "#123456"]];

  it("matches case-insensitively", () => {
    expect(remapLiteralColorsInText("color:#0C5AA0;color:#0c5aa0;", cssVarsTheme, entries)).toBe(
      "color:#123456;color:#123456;",
    );
  });

  it("matches the 3-digit shorthand of the same color", () => {
    const theme: ThemeDef = { mode: "css_vars", roles: { brand: { var: "--brand", hex: "#ffffff" } } };
    expect(remapLiteralColorsInText("bg:#fff; bg2:#FFF; bg3:#ffffff;", theme, [["brand", "#123456"]])).toBe(
      "bg:#123456; bg2:#123456; bg3:#123456;",
    );
  });

  it("does NOT invent a shorthand for a color that has none (channels don't double up)", () => {
    // #0C5AA0's channels are 0c/5a/a0 — none doubled, so it has no valid
    // 3-digit form; "#c5a" must never be treated as a match for it.
    expect(remapLiteralColorsInText("x:#c5a;", cssVarsTheme, entries)).toBe("x:#c5a;");
  });

  it("never matches a partial occurrence inside a longer hex-with-alpha token", () => {
    expect(remapLiteralColorsInText("border:#0c5aa0ff;", cssVarsTheme, entries)).toBe("border:#0c5aa0ff;");
  });

  it("never matches a partial occurrence inside a longer id/class token", () => {
    expect(remapLiteralColorsInText('<div id="#0c5aa0-box">', cssVarsTheme, entries)).toBe(
      '<div id="#0c5aa0-box">',
    );
  });

  it("still matches the exact color immediately followed by a non-word, non-hyphen character", () => {
    expect(remapLiteralColorsInText("color:#0c5aa0;color:#0c5aa0 solid;color:#0c5aa0)", cssVarsTheme, entries)).toBe(
      "color:#123456;color:#123456 solid;color:#123456)",
    );
  });

  it("a color not mapped to any role is left alone", () => {
    expect(remapLiteralColorsInText("a:#0c5aa0;b:#999999;", cssVarsTheme, entries)).toBe("a:#123456;b:#999999;");
  });

  it("round-trip: when the doc hex equals the role's own demo hex, remapping is an identity transform", () => {
    // This is the property that makes the fix safe for the compiler's own
    // round-trip verification (samples carry the template's own demo hexes).
    const text = "border-color:#0C5AA0; a{color:#0c5aa0}";
    expect(remapLiteralColorsInText(text, cssVarsTheme, [["brand", "#0C5AA0"]])).toBe(text);
  });
});

describe("applyThemeToHtml — retints a rendered page's inline styles (css_vars mode)", () => {
  it("replaces a literal role hex inside an inline style attribute", () => {
    const html = `<html><body><h1 style="color:#0C5AA0">Hi</h1></body></html>`;
    const out = applyThemeToHtml(html, cssVarsTheme, { brand: "#123456" });
    expect(out).toBe(`<html><body><h1 style="color:#123456">Hi</h1></body></html>`);
  });

  it("replaces a literal role hex inside an embedded <style> block", () => {
    const html = `<html><head><style>.hero{background:#F24F24}</style></head><body></body></html>`;
    const out = applyThemeToHtml(html, cssVarsTheme, { brand_deep: "#654321" });
    expect(out).toContain(".hero{background:#654321}");
  });

  it("is a no-op in literal_remap mode (HTML coverage is scoped to css_vars only)", () => {
    const literalTheme: ThemeDef = { mode: "literal_remap", roles: { brand: { hex: "#0C5AA0" } } };
    const html = `<div style="color:#0C5AA0"></div>`;
    expect(applyThemeToHtml(html, literalTheme, { brand: "#123456" })).toBe(html);
  });

  it("is a no-op when docTheme has no entry for any mapped role", () => {
    const html = `<div style="color:#0C5AA0"></div>`;
    expect(applyThemeToHtml(html, cssVarsTheme, {})).toBe(html);
  });

  it("round-trip: doc hex equal to the template's own demo hex reproduces the original HTML exactly", () => {
    const html = `<div style="color:#0C5AA0;border-color:#F24F24"></div>`;
    const out = applyThemeToHtml(html, cssVarsTheme, { brand: "#0C5AA0", brand_deep: "#F24F24" });
    expect(out).toBe(html);
  });
});
