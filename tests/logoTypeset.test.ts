// @vitest-environment node
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { applyCase, fontsFor, missingChars, setText } from "@/lib/logos/typeset";
import { LOGO_FONTS } from "@/lib/logos/fontList";
import { composeLockup, initialsFor, inkOnWhite, lockupSvg, textOn, type LockupInput } from "@/lib/logos/compose";
import { contrast } from "@/lib/site-builder/palette";

/**
 * The name on a logo is typeset from a font file — letter by letter exactly
 * as typed, every letter properly formed — and put beside the symbol in code.
 * No image model ever draws a letter of it.
 */

const NAME = "Garcia's Roofing & Repair";

describe("typesetting", () => {
  it("every catalogue font loads and has every letter a business name needs", async () => {
    for (const f of LOGO_FONTS) {
      const { main, companion } = await fontsFor(f.key);
      expect(missingChars(main, `${NAME} 0123456789 éñüÇ’-.,!`), f.key).toEqual([]);
      expect(missingChars(companion, NAME.toUpperCase()), f.key).toEqual([]);
    }
  });

  it("draws exactly the characters it was given, in order (ligatures included)", async () => {
    const { main } = await fontsFor("montserrat");
    const run = main.layout(applyCase(NAME, "upper"));
    expect(String.fromCodePoint(...run.glyphs.flatMap((g) => g.codePoints))).toBe("GARCIA'S ROOFING & REPAIR");
    const lower = main.layout("office fifty");
    expect(String.fromCodePoint(...lower.glyphs.flatMap((g) => g.codePoints))).toBe("office fifty");
  });

  it("uses the font's kerning, and letter spacing widens it", async () => {
    const { main } = await fontsFor("montserrat");
    const av = setText(main, "AV", 100).width;
    const apart = setText(main, "A", 100).width + setText(main, "V", 100).width;
    expect(av).toBeLessThan(apart);
    expect(setText(main, "ABC", 100, 0.2).width).toBeCloseTo(setText(main, "ABC", 100).width + 2 * 20, 5);
  });

  it("case: upper, or title that only capitalises words typed in lower case", () => {
    expect(applyCase("abc roofing", "upper")).toBe("ABC ROOFING");
    expect(applyCase("abc roofing ABC iRepair", "title")).toBe("Abc Roofing ABC iRepair");
    expect(applyCase("iRepair", "as-is")).toBe("iRepair");
  });
});

describe("the lockup", () => {
  const base: LockupInput = { layout: "wordmark", lines: [NAME], font: "montserrat", letterCase: "upper", tracking: 0.02, nameColor: "#1e3a8a", subColor: "#ea580c", twoTone: false };
  const icon = async () => {
    const png = await sharp({ create: { width: 300, height: 260, channels: 4, background: { r: 234, g: 88, b: 12, alpha: 1 } } }).png().toBuffer();
    return { png, width: 300, height: 260 };
  };

  it("is outlines only — no <text> to depend on installed fonts — and horizontal", async () => {
    const { svg, width, height } = await lockupSvg(base);
    expect(svg).not.toMatch(/<text/);
    expect(svg).toMatch(/<path transform="translate\(0\.00 0\.00\)" d="M/);
    expect(width / height).toBeGreaterThan(4);
  });

  it("symbol on the left, sized to the name; two lines make it taller; a badge holds the initials", async () => {
    const one = await lockupSvg({ ...base, layout: "icon-left", icon: await icon() });
    expect(one.svg).toMatch(/<image x="-[\d.]+" y="-[\d.]+" width="[\d.]+" height="[\d.]+" preserveAspectRatio="none" xlink:href="data:image\/png;base64,/);
    const two = await lockupSvg({ ...base, layout: "icon-left", lines: ["Garcia's", "Roofing & Repair"], icon: await icon() });
    expect(two.height / two.width).toBeGreaterThan(one.height / one.width);
    const badge = await lockupSvg({ ...base, layout: "badge-left", badge: { shape: "shield", color: "#ea580c", initials: "GR" } });
    expect(badge.svg).toMatch(/<path d="M[^"]+Z" fill="#ea580c"\/>/);
    expect(badge.svg).toMatch(/fill="#ffffff"/); // white initials on the orange badge
  });

  it("renders a transparent PNG", async () => {
    const r = await composeLockup({ ...base, layout: "badge-left", badge: { shape: "circle", color: "#1e3a8a", initials: "GR" } });
    const meta = await sharp(r.png).metadata();
    expect(meta).toMatchObject({ format: "png", hasAlpha: true, width: r.width, height: r.height });
    const { data } = await sharp(r.png).raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0); // a corner: see-through
  });

  it("a light colour that wouldn't read on white is deepened", async () => {
    expect(contrast(inkOnWhite("#facc15"), "#ffffff")).toBeGreaterThanOrEqual(2.4);
    expect(inkOnWhite("#1e3a8a")).toBe("#1e3a8a");
    const { svg } = await lockupSvg({ ...base, nameColor: "#fde047" });
    expect(svg).not.toMatch(/fill="#fde047"/);
    expect(textOn("#ea580c")).toBe("#ffffff");
    expect(textOn("#fde047")).toBe("#111827");
  });

  it("initials skip little words and legal endings", () => {
    expect(initialsFor(NAME)).toBe("GR");
    expect(initialsFor("The Smith & Co.")).toBe("S");
    expect(initialsFor("Zenith")).toBe("Z");
  });
});
