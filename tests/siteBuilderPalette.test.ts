// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  assignThemeSlots,
  buildPalette,
  colorDistance,
  contrast,
  describePalette,
  isLightColor,
  isSurfaceSlot,
  resolveSchemeColors,
  type ThemeSlot,
} from "@/lib/site-builder/palette";

/**
 * The lead's colour scheme → the site's colour roles, in code. Until
 * 2026-10-14 the model chose the theme itself and often didn't follow the
 * scheme: it reordered colours, kept the template's own accent, and painted a
 * scheme's WHITE onto buttons and stars (white text on white buttons).
 */

// The SITE THEME slots of the four in-service templates, as their files mark them.
const ROOF_SMART: ThemeSlot[] = [
  { name: "--green", marker: "PRIMARY", role: "buttons, links, icons, highlights", value: "#2f7d32" },
  { name: "--gold", marker: "ACCENT", role: "stars, small highlights", value: "#c9a227" },
  { name: "--charcoal-deep", marker: "DARK", role: "top bar, header, footer backgrounds", value: "#1f1f1f" },
];
const AJR: ThemeSlot[] = [
  { name: "--craft-navy", marker: "PRIMARY", role: "headings, dark sections, nav text", value: "#1b2a4a" },
  { name: "--accent-warm", marker: "ACCENT", role: "buttons, highlights, icons", value: "#e8651a" },
];
const NORTHPOINT: ThemeSlot[] = [
  { name: "--brand", marker: "PRIMARY", role: "buttons, links, highlights", value: "#0d63d3" },
  { name: "--accent", marker: "ACCENT", role: "CTA buttons, logo mark, hot highlights", value: "#da6416" },
  { name: "--navy", marker: "DARK", role: "hero, header, footer backgrounds", value: "#07152b" },
];
const YY_TILE: ThemeSlot[] = [
  { name: "--green", marker: "PRIMARY", role: "buttons, links, brand mark, highlights", value: "#15603a" },
  { name: "--ink", marker: "DARK", role: "text, header brand, footer background", value: "#15181b" },
  { name: "--accent", marker: "ACCENT", role: "secondary highlight", value: "#fc1d1d" },
];
const TEMPLATES = { ROOF_SMART, AJR, NORTHPOINT, YY_TILE };

describe("resolveSchemeColors", () => {
  it("keeps the lead's order; names become brand shades, bare hex gets its #; repeats and unknowns drop", () => {
    expect(resolveSchemeColors("Navy, ff6600, navy, blurple, #fff, red")).toEqual(["#1e3a8a", "#ff6600", "#ffffff", "#dc2626"]);
    expect(resolveSchemeColors("red, orange, yellow, green, blue, purple")).toHaveLength(5);
    expect(resolveSchemeColors("")).toEqual([]);
    expect(resolveSchemeColors(null)).toEqual([]);
  });
});

describe("buildPalette", () => {
  it("1st colour primary, 2nd secondary, 3rd complementary — exactly as given", () => {
    const p = buildPalette("#0C5AA0, #F24F24, #2E8B57")!;
    expect(p).toMatchObject({ primary: "#0c5aa0", secondary: "#f24f24", complementary: "#2e8b57" });
  });

  it("white and very light colours are backgrounds, never the button colour", () => {
    const p = buildPalette("white, orange")!;
    expect(p.primary).toBe("#ea580c");
    expect(p.secondary).toBeNull();
    expect(p.lights).toEqual(["#ffffff"]);
    // ...and a white listed first doesn't push the third brand colour out.
    expect(buildPalette("white, #0C5AA0, #F24F24, #2E8B57")).toMatchObject({
      primary: "#0c5aa0", secondary: "#f24f24", complementary: "#2e8b57", lights: ["#ffffff"],
    });
  });

  it("black runs the dark areas instead of the buttons", () => {
    expect(buildPalette("black, red")).toMatchObject({ primary: "#dc2626", dark: "#111111", darkFromLead: true });
  });

  it("with no dark colour, the dark areas are a near-black tinted with the primary — not a heavy maroon", () => {
    const p = buildPalette("#ce1c1c, white")!;
    expect(p).toMatchObject({ primary: "#ce1c1c", dark: "#2d1313", darkFromLead: false });
    expect(contrast(p.dark, "#ffffff")).toBeGreaterThan(15);
  });

  it("a scheme with no usable colour leaves the template's palette alone", () => {
    expect(buildPalette("")).toBeNull();
    expect(buildPalette("sparkly")).toBeNull();
    expect(buildPalette(undefined)).toBeNull();
  });
});

describe("assignThemeSlots", () => {
  it("Roof Smart: primary on the buttons, secondary on the accents, the dark colour on the header and footer", () => {
    expect(assignThemeSlots(ROOF_SMART, buildPalette("#078df2, #fc1d1d")!)).toEqual({
      "--green": "#078df2",
      "--gold": "#fc1d1d",
      "--charcoal-deep": "#102433",
    });
  });

  it("REGRESSION (Sterling, Garcia's): a scheme's white is never the accent — stars and highlights get a brand colour", () => {
    const values = assignThemeSlots(ROOF_SMART, buildPalette("#B37B50, white")!);
    expect(values["--gold"]).toBe("#b37b50");
    expect(values["--green"]).toBe("#b37b50");
  });

  it("REGRESSION (Jumbo's \"black, red\"): red is the primary, black the dark areas — never the other way round", () => {
    expect(assignThemeSlots(NORTHPOINT, buildPalette("black, red")!)).toMatchObject({ "--brand": "#dc2626", "--navy": "#111111" });
  });

  it("a dark area that would swallow dark-primary buttons becomes a neutral near-black — the brand colour stays", () => {
    expect(assignThemeSlots(ROOF_SMART, buildPalette("#2a3550, gold")!)).toEqual({
      "--green": "#2a3550",
      "--gold": "#d4af37",
      "--charcoal-deep": "#0b0d10",
    });
    // navy buttons on their own tinted near-black still stand out
    expect(assignThemeSlots(ROOF_SMART, buildPalette("navy, gold")!)).toMatchObject({ "--green": "#1e3a8a", "--charcoal-deep": "#131723" });
  });

  it("AJR (PRIMARY is its dark sections): sections deep enough for white text, buttons distinct from them", () => {
    // One brand colour: the sections take a deeper shade so the buttons, in
    // a tint of the same colour, still stand out on them.
    expect(assignThemeSlots(AJR, buildPalette("#4b18aa, #e9e2e2")!)).toEqual({ "--craft-navy": "#2d0e66", "--accent-warm": "#815dc4" });
    // Two: the sections take the primary when white reads on it, the buttons the secondary.
    expect(assignThemeSlots(AJR, buildPalette("#0C5AA0, #F24F24")!)).toEqual({ "--craft-navy": "#0c5aa0", "--accent-warm": "#f24f24" });
    // A primary too light for white text is deepened for the sections.
    expect(assignThemeSlots(AJR, buildPalette("#078df2, #fc1d1d")!)).toEqual({ "--craft-navy": "#045591", "--accent-warm": "#fc1d1d" });
  });

  it("every template, every real scheme: exact primary, readable dark areas, no light fill, no fill lost on its surface", () => {
    const schemes = [
      "green and white", "#B37B50, white", "orange ,white", "orange, #ecdfdf", "#4b18aa, #e9e2e2", "BLUE ,WHITE",
      "black ,red", "#078df2, #fc1d1d", "#C19A6B,white and black", "#ce1c1c, white", "navy, gold",
      "#0e2642, #55ad9d, #fefefe", "050505, D4AF37, 8C6725", "#0C5AA0, #F24F24, #2E8B57", "#2a3550, gold",
      "#4fade4, #fc9a10", "blue,silver,gold", "#838181, #808080", "#ff8c00, #aaa9ad", "red, yellow, #a04a03",
    ];
    for (const scheme of schemes) {
      const p = buildPalette(scheme)!;
      for (const [template, slots] of Object.entries(TEMPLATES)) {
        const values = assignThemeSlots(slots, p);
        const at = `${template} / ${scheme}`;
        expect(Object.keys(values).sort(), at).toEqual(slots.map((s) => s.name).sort());
        const surfaces = slots.filter(isSurfaceSlot).map((s) => values[s.name]);
        for (const surface of surfaces) expect(contrast(surface, "#ffffff"), at).toBeGreaterThanOrEqual(4.5);
        for (const slot of slots.filter((s) => !isSurfaceSlot(s))) {
          const fill = values[slot.name];
          if (slot.marker === "PRIMARY") expect(fill, at).toBe(p.primary);
          expect(isLightColor(fill), `${at} ${slot.name}=${fill}`).toBe(false);
          for (const surface of surfaces) {
            const lost = contrast(fill, surface) < 1.5 && colorDistance(fill, surface) < 0.15;
            expect(lost, `${at} ${slot.name}=${fill} on ${surface}`).toBe(false);
          }
        }
      }
    }
  });
});

describe("describePalette", () => {
  it("spells the roles out in the lead's order, for the prompts", () => {
    expect(describePalette(buildPalette("#0C5AA0, #F24F24, #2E8B57, white")!)).toBe(
      "primary #0c5aa0 (buttons, links, icons, highlights); secondary #f24f24 (accents, badges, call-to-action details); " +
        "complementary #2e8b57 (small extra accents); dark areas #101c26 (top bar, header, footer, dark sections); " +
        "light areas #ffffff (backgrounds)",
    );
    expect(describePalette(buildPalette("navy")!)).toContain("light areas white (backgrounds)");
    expect(describePalette(buildPalette("orange, #ecdfdf")!)).toContain("light areas #ecdfdf (backgrounds)");
  });
});
