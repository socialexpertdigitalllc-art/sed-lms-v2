import { colorToHex, normalizeHex } from "./colorScheme";

/**
 * Colour-theory partners for a single brand colour.
 *
 * Deliberately deterministic and dependency-free. The AI route on top of this
 * picks the one that suits the niche and explains it, but an agent is filling
 * a form: a suggestion that only appears when a model answers is a suggestion
 * that often does not appear at all. These land instantly and are always the
 * fallback when the model is slow, down, or returns something unusable.
 */

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function hexToHsl(hex: string): Hsl | null {
  const norm = normalizeHex(hex);
  if (!norm) return null;
  const r = parseInt(norm.slice(1, 3), 16) / 255;
  const g = parseInt(norm.slice(3, 5), 16) / 255;
  const b = parseInt(norm.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(Math.max(s, 0), 1);
  const lig = Math.min(Math.max(l, 0), 1);
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lig - c / 2;
  const seg = Math.floor(hue / 60) % 6;
  const [r1, g1, b1] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][seg];
  const to2 = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to2(r1)}${to2(g1)}${to2(b1)}`;
}

/** Relative luminance, per WCAG 2.x. */
function luminance(hex: string): number {
  const norm = normalizeHex(hex) ?? "#000000";
  const ch = [1, 3, 5].map((i) => {
    const v = parseInt(norm.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG contrast ratio between two colours, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export interface HarmonyOption {
  hex: string;
  /** How this colour relates to the base — shown to the agent as the reason. */
  kind: "complement" | "analogous" | "triadic" | "neutral";
}

/**
 * Partners for `base`, best first.
 *
 * A near-grey base has no meaningful hue to rotate, so it gets a warm accent
 * instead of a "complement" that would come back as another grey — an agent
 * offered grey-plus-grey would rightly ignore the whole feature.
 */
export function harmonyOptions(base: string): HarmonyOption[] {
  const hsl = hexToHsl(colorToHex(base) ?? base);
  if (!hsl) return [];

  if (hsl.s < 0.12) {
    // Effectively greyscale: pair it with a confident accent, light or dark to
    // stay legible against the base.
    const accentL = hsl.l > 0.5 ? 0.42 : 0.62;
    return [
      { hex: hslToHex({ h: 210, s: 0.75, l: accentL }), kind: "neutral" },
      { hex: hslToHex({ h: 18, s: 0.72, l: accentL }), kind: "neutral" },
    ];
  }

  // Keep partners in a usable band: a suggestion that is nearly black or
  // nearly white reads as a mistake next to a saturated brand colour.
  const l = Math.min(Math.max(hsl.l, 0.32), 0.62);
  const s = Math.min(Math.max(hsl.s, 0.35), 0.85);

  return [
    { hex: hslToHex({ h: hsl.h + 180, s, l }), kind: "complement" },
    { hex: hslToHex({ h: hsl.h + 150, s, l }), kind: "triadic" },
    { hex: hslToHex({ h: hsl.h + 30, s, l: Math.min(l + 0.12, 0.72) }), kind: "analogous" },
  ];
}

/** The single best partner for `base`, or null when `base` is not a colour. */
export function bestComplement(base: string): string | null {
  return harmonyOptions(base)[0]?.hex ?? null;
}

export const HARMONY_LABEL: Record<HarmonyOption["kind"], string> = {
  complement: "Complementary",
  analogous: "Analogous",
  triadic: "Triadic",
  neutral: "Accent",
};
