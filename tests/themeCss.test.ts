import { describe, it, expect } from "vitest";
import {
  buildThemeOverrideCss,
  isHexColor,
  isNeutralHex,
  findThemeVariables,
  planThemeApplication,
  applyThemeToCss,
} from "@/lib/template-engine/themeCss";

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

// ---------------------------------------------------------------------------
// Template-aware theming. Every fixture below is a template that does NOT look
// like the one this engine shipped with — that is the whole point: the bug was
// that --brand/--brand-deep/--accent were hardcoded, so a newly uploaded
// template got an override that targeted nothing.
// ---------------------------------------------------------------------------

const CLIENT = { brand: "#0F152D", brand_deep: "#0a0f20", accent: "#7394F3" };

// A template using its OWN variable names, nothing like --brand/--accent.
const VAR_TEMPLATE = `
:root {
  --primary: #c2410c;
  --primary-dark: #7c2d12;
  --accent-color: #0891b2;
  --ink: #111827;
  --paper: #ffffff;
}
.btn { background: var(--primary); color: var(--paper); }
.hero { background: linear-gradient(var(--primary), var(--primary-dark)); }
.hero h1 { color: var(--ink); }
a:hover { color: var(--accent-color); }
.badge { border-color: var(--primary); }
`;

// A template with NO custom properties at all — hardcoded hex everywhere.
const HEX_TEMPLATE = `
body { background: #FFFFFF; color: #222; }
.btn { background: #c2410c; border: 1px solid #c2410c; }
.btn:hover { background: #7C2D12; }
.hero { background: #c2410c; }
.rule { border-top: 1px solid #eee; }
.tag { color: #0891b2; }
`;

describe("isNeutralHex", () => {
  it("treats white, black and greys as neutral, brand colors as not", () => {
    expect(isNeutralHex("#ffffff")).toBe(true);
    expect(isNeutralHex("#fff")).toBe(true);
    expect(isNeutralHex("#000")).toBe(true);
    expect(isNeutralHex("#222")).toBe(true);
    expect(isNeutralHex("#eee")).toBe(true);
    expect(isNeutralHex("#f8f9fa")).toBe(true);
    expect(isNeutralHex("#c2410c")).toBe(false);
    expect(isNeutralHex("#0891b2")).toBe(false);
  });
});

describe("findThemeVariables", () => {
  it("ranks a foreign template's own color vars by how often they are referenced", () => {
    const vars = findThemeVariables(VAR_TEMPLATE).map((v) => v.name);
    expect(vars[0]).toBe("--primary"); // 3 refs
    expect(vars).toContain("--primary-dark");
    expect(vars).toContain("--accent-color");
  });
  it("ignores neutral-valued vars, so brand color never lands on text/background", () => {
    const vars = findThemeVariables(VAR_TEMPLATE).map((v) => v.name);
    expect(vars).not.toContain("--ink");
    expect(vars).not.toContain("--paper");
  });
  it("ignores declared-but-never-referenced vars and non-root blocks", () => {
    expect(findThemeVariables(":root{--unused:#c2410c}").length).toBe(0);
    expect(findThemeVariables(".card{--local:#c2410c}.x{color:var(--local)}").length).toBe(0);
  });
});

describe("planThemeApplication", () => {
  it("binds the client's colors onto a foreign template's OWN variable names", () => {
    const plan = planThemeApplication(VAR_TEMPLATE, CLIENT);
    expect(plan.strategy).toBe("vars");
    expect(plan.boundVars).toEqual(["--primary", "--primary-dark", "--accent-color"]);
    expect(plan.overrideCss).toContain("--primary: #0F152D");
    expect(plan.overrideCss).toContain("--primary-dark: #0a0f20");
    expect(plan.overrideCss).toContain("--accent-color: #7394F3");
    expect(plan.replacements).toEqual({});
  });
  it("still emits the legacy override, so the ORIGINAL template keeps working", () => {
    const plan = planThemeApplication(VAR_TEMPLATE, CLIENT);
    expect(plan.overrideCss).toContain("--brand: #0F152D");
    expect(plan.overrideCss).toContain("--brand-deep: #0a0f20");
    expect(plan.overrideCss).toContain("--accent: #7394F3");
  });
  it("falls back to remapping dominant hex values when there are no color vars", () => {
    const plan = planThemeApplication(HEX_TEMPLATE, CLIENT);
    expect(plan.strategy).toBe("hex");
    expect(plan.replacements).toEqual({
      "#c2410c": "#0F152D", // 3 occurrences -> primary
      "#7c2d12": "#0a0f20", // 1, first seen -> supporting
      "#0891b2": "#7394F3", // 1 -> accent
    });
  });
  it("changes nothing when the template is all neutrals", () => {
    const plan = planThemeApplication("body{color:#222;background:#fff;border:1px solid #eee}", CLIENT);
    expect(plan.strategy).toBe("none");
    expect(plan.replacements).toEqual({});
  });
  it("changes nothing when the theme is absent or unusable", () => {
    expect(planThemeApplication(VAR_TEMPLATE, undefined).strategy).toBe("none");
    expect(planThemeApplication(VAR_TEMPLATE, { brand: "royal blue" }).overrideCss).toBe("");
    expect(planThemeApplication("", CLIENT).strategy).toBe("none");
  });
  it("never emits a color the lead typed that is not a validated hex", () => {
    const plan = planThemeApplication(VAR_TEMPLATE, { brand: "red; } body{display:none} .x{a:b" });
    expect(plan.overrideCss).toBe("");
    expect(plan.strategy).toBe("none");
  });
  it("binds only the slots the lead actually supplied", () => {
    const plan = planThemeApplication(VAR_TEMPLATE, { brand: "#123456" });
    expect(plan.boundVars).toEqual(["--primary"]);
    expect(plan.overrideCss).not.toContain("--primary-dark");
  });
});

describe("applyThemeToCss", () => {
  it("appends the override for a variable-based foreign template, body untouched", () => {
    const out = applyThemeToCss(VAR_TEMPLATE, CLIENT);
    expect(out.startsWith(VAR_TEMPLATE)).toBe(true); // byte-for-byte, then appended
    expect(out).toContain("--primary: #0F152D");
  });
  it("rewrites the dominant hex values in place, preserving everything else", () => {
    const out = applyThemeToCss(HEX_TEMPLATE, CLIENT);
    expect(out).toContain(".btn { background: #0F152D; border: 1px solid #0F152D; }");
    expect(out).toContain(".btn:hover { background: #0a0f20; }");
    expect(out).toContain(".tag { color: #7394F3; }");
    expect(out).toContain("body { background: #FFFFFF; color: #222; }"); // neutrals kept
    expect(out).toContain(".rule { border-top: 1px solid #eee; }");
    expect(out).not.toContain("#c2410c");
  });
  it("leaves an all-neutral stylesheet byte-identical apart from the legacy block", () => {
    const css = "body{color:#222;background:#fff}";
    expect(applyThemeToCss(css, CLIENT)).toBe(css + buildThemeOverrideCss(CLIENT));
  });
  it("is a total no-op when there is no usable theme", () => {
    expect(applyThemeToCss(HEX_TEMPLATE, { brand: "" })).toBe(HEX_TEMPLATE);
    expect(applyThemeToCss(HEX_TEMPLATE, undefined)).toBe(HEX_TEMPLATE);
  });
});
