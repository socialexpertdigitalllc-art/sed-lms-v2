import { describe, it, expect } from "vitest";
import { buildThemeOverrideCss, isHexColor } from "@/lib/template-engine/themeCss";

describe("isHexColor", () => {
  it("accepts #rgb and #rrggbb", () => {
    expect(isHexColor("#abc")).toBe(true);
    expect(isHexColor("#1d4ed8")).toBe(true);
    expect(isHexColor("#1D4ED8")).toBe(true);
  });
  it("rejects anything that is not a plain hex color", () => {
    expect(isHexColor("royal blue")).toBe(false);
    expect(isHexColor("rgb(0,0,0)")).toBe(false);
    expect(isHexColor("#12")).toBe(false);
    expect(isHexColor("#1234")).toBe(false);
    expect(isHexColor("")).toBe(false);
    expect(isHexColor("url(javascript:x)")).toBe(false);
  });
});

describe("buildThemeOverrideCss", () => {
  it("emits a :root override for the valid hex vars only", () => {
    const css = buildThemeOverrideCss({ brand: "#0F152D", brand_deep: "#0a0f20", accent: "#7394F3" });
    expect(css).toContain(":root");
    expect(css).toContain("--brand: #0F152D");
    expect(css).toContain("--brand-deep: #0a0f20");
    expect(css).toContain("--accent: #7394F3");
  });
  it("skips non-hex values (never injects arbitrary text into CSS)", () => {
    const css = buildThemeOverrideCss({ brand: "#0F152D", accent: "royal blue" });
    expect(css).toContain("--brand: #0F152D");
    expect(css).not.toContain("royal blue");
    expect(css).not.toContain("--accent");
  });
  it("returns an empty string when nothing is a valid color (keeps template palette)", () => {
    expect(buildThemeOverrideCss({ brand: "up to us", accent: "" })).toBe("");
    expect(buildThemeOverrideCss({})).toBe("");
    expect(buildThemeOverrideCss(undefined)).toBe("");
  });
  it("is appendable — starts on its own line with a marker comment", () => {
    const css = buildThemeOverrideCss({ brand: "#111111" });
    expect(css.startsWith("\n")).toBe(true);
    expect(css).toContain("client brand colors");
  });
});
