// lib/site-builder/palette.ts
/**
 * The lead's colour scheme, turned into the site's colour ROLES — in code, so
 * the generated site follows it every time.
 *
 * Until 2026-10-14 the AI model read "Colour scheme: orange, white" and chose
 * the theme itself. Measured on that day's live sites, it regularly didn't
 * follow the scheme: it kept the template's own accent (Vonch's), reordered the
 * colours (Jumbo's "black, red" became red-first), invented shades (Optimistic
 * HVAC), and — the worst one — painted the scheme's WHITE or light grey onto
 * the buttons and highlights (Sterling, Garcia's, MEM Cleaning, Danny Hiott,
 * Hird), leaving white text on white buttons.
 *
 * The rules, in the order the operator gives the colours:
 *  - 1st colour = PRIMARY, 2nd = SECONDARY, 3rd = COMPLEMENTARY;
 *  - white and very light colours are the light backgrounds — never painted
 *    onto a button or a highlight;
 *  - black / near-black runs the dark areas (top bar, header, footer, dark
 *    sections) instead of being a button colour; with no dark colour given,
 *    the dark areas are a near-black tinted with the primary;
 *  - colour NAMES become tasteful brand shades ("blue" is #1d4ed8, not the
 *    screen-blue #0000ff the lead form's swatch shows).
 * Readable text on every colour is the contrast guard's job (contrastGuard.ts).
 */
import { normalizeHex, parseColorScheme } from "@/lib/leads/colorScheme";

/** Brand-friendly shades for colour names sales types into the lead form. */
const BRAND_SHADES: Record<string, string> = {
  black: "#111111", white: "#ffffff", offwhite: "#faf9f6", ivory: "#fffff0", cream: "#fdf6e3",
  beige: "#efe6d2", grey: "#6b7280", gray: "#6b7280", lightgrey: "#d1d5db", lightgray: "#d1d5db",
  darkgrey: "#374151", darkgray: "#374151", silver: "#a8a9ad", charcoal: "#2b2f33", slate: "#475569",
  red: "#dc2626", darkred: "#991b1b", crimson: "#be123c", maroon: "#7f1d1d", burgundy: "#7f1d2d", ruby: "#be123c",
  orange: "#ea580c", darkorange: "#c2410c", coral: "#f97352", salmon: "#fa8072", peach: "#fdba74", rust: "#b7410e",
  terracotta: "#c2603f", yellow: "#facc15", gold: "#d4af37", amber: "#f59e0b", mustard: "#e1ad01",
  green: "#15803d", darkgreen: "#14532d", lightgreen: "#4ade80", lime: "#65a30d", olive: "#6b7a1f",
  forestgreen: "#166534", mint: "#6ee7b7", emerald: "#059669", sage: "#8a9a5b",
  teal: "#0f766e", turquoise: "#14b8a6", cyan: "#06b6d4", aqua: "#06b6d4",
  blue: "#1d4ed8", darkblue: "#1e3a8a", navy: "#1e3a8a", navyblue: "#1e3a8a", royalblue: "#2563eb",
  lightblue: "#60a5fa", skyblue: "#38bdf8", babyblue: "#93c5fd", sapphire: "#0f52ba", cobalt: "#0047ab",
  purple: "#7e22ce", violet: "#8b5cf6", indigo: "#4338ca", lavender: "#c4b5fd", plum: "#8e4585",
  magenta: "#c026d3", pink: "#db2777", hotpink: "#ec4899", rose: "#e11d48",
  brown: "#7c4a1e", darkbrown: "#4a2c12", chocolate: "#7b3f00", tan: "#c8a27a", bronze: "#a97142",
  copper: "#b87333", khaki: "#c3b091", sand: "#d8c3a5",
};

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = (normalizeHex(hex) ?? "#000000").slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const to2 = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

/** WCAG relative luminance, 0 (black) .. 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio, 1..21. */
export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** `a` mixed toward `b` by `t` (0 = a, 1 = b), in sRGB like CSS color-mix. */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as Rgb);
}

/** HSL saturation, 0..1 — how far from grey a colour is. */
export function saturation(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return 0;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

/** The colour darkened toward black just until white text on it reaches
 *  `minContrast` (keeps its hue; returns it unchanged when already there). */
export function deepenFor(hex: string, minContrast: number): string {
  if (contrast(hex, "#ffffff") >= minContrast) return hex;
  for (let t = 0.05; t <= 1; t += 0.05) {
    const c = mix(hex, "#000000", t);
    if (contrast(c, "#ffffff") >= minContrast) return c;
  }
  return "#000000";
}

/**
 * The dark areas' colour when the lead names none: a near-black with a touch
 * of the primary's hue. Not a deep shade of the primary itself — templates
 * derive their header and card shades by lightening this colour, and a deep
 * red or orange lightens into a muddy maroon or brown, with the brand-coloured
 * buttons on it hard to pick out (Garcia's, 2026-10-14).
 */
export function tintedDark(hex: string): string {
  return mix("#111111", hex, 0.15);
}

/** One lead colour, resolved: names to brand shades, bare hex given a "#". */
export function resolveColor(entry: string): string | null {
  const key = entry.trim().toLowerCase().replace(/[\s_-]+/g, "");
  return BRAND_SHADES[key] ?? normalizeHex(entry);
}

/** The lead's colours, resolved, in order, at most five (white and black
 *  usually ride along with up to three brand colours). Unknown entries (the
 *  lead form already warns about those) are skipped. */
export function resolveSchemeColors(raw: string | null | undefined): string[] {
  const out: string[] = [];
  for (const entry of parseColorScheme(raw ?? "")) {
    const hex = resolveColor(entry);
    if (hex && !out.includes(hex)) out.push(hex);
    if (out.length === 5) break;
  }
  return out;
}

/** White and very light colours: backgrounds, never fills. */
export const isLightColor = (hex: string) => luminance(hex) >= 0.7;
/** Black and near-black (incl. the deepest navies): the dark areas. */
export const isDarkColor = (hex: string) => luminance(hex) <= 0.035;

export interface BrandPalette {
  /** The lead's colours, resolved, in the order given. */
  colors: string[];
  primary: string;
  secondary: string | null;
  complementary: string | null;
  /** For the top bar, header, footer and dark sections. */
  dark: string;
  /** True when `dark` came from the lead (a black/near-black colour), false
   *  when it is a near-black tinted with the primary. */
  darkFromLead: boolean;
  /** The light colours the lead gave (white, cream…) — the backgrounds. */
  lights: string[];
}

/**
 * The roles for a lead's colour scheme, or null when it names no usable
 * colour (the template's own palette then stays, as before).
 */
export function buildPalette(raw: string | null | undefined): BrandPalette | null {
  const colors = resolveSchemeColors(raw);
  if (!colors.length) return null;
  const lights = colors.filter(isLightColor);
  const solid = colors.filter((c) => !isLightColor(c));
  const darks = solid.filter(isDarkColor);
  const brand = solid.filter((c) => !isDarkColor(c));

  // Fills (buttons, links, highlights) come from the chromatic/mid colours in
  // the lead's order. A scheme of only black (+ white) keeps black as the fill.
  const fills = brand.length ? brand : darks.length ? [darks[0]] : [deepenFor(lights[0], 4.5)];
  const darkFromLead = darks.length > 0 && brand.length > 0;
  return {
    colors,
    primary: fills[0],
    secondary: fills[1] ?? null,
    complementary: fills[2] ?? null,
    dark: darkFromLead ? darks[0] : tintedDark(fills[0]),
    darkFromLead,
    lights,
  };
}

/** One base variable of a template's SITE THEME (see siteTheme.ts). */
export interface ThemeSlot {
  /** The CSS custom property, e.g. "--green". */
  name: string;
  marker: "PRIMARY" | "SECONDARY" | "ACCENT" | "COMPLEMENTARY" | "DARK";
  /** The template's own description of where the colour shows. */
  role: string;
  /** The template's own value. */
  value: string;
}

/** A slot whose colour is a SURFACE that text sits on (a dark section, the
 *  header/footer background) rather than a fill drawn on a light page. */
export function isSurfaceSlot(slot: ThemeSlot): boolean {
  if (slot.marker === "DARK") return true;
  return /\b(dark|section|sections|background|backgrounds|header|footer|hero|top ?bar)\b/i.test(slot.role) &&
    !/\bbuttons?\b/i.test(slot.role);
}

/** OKLab — a perceptual colour space: equal distances look equally different. */
export function oklab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Perceptual distance between two colours (OKLab ΔE; ~0.02 is just noticeable). */
export function colorDistance(a: string, b: string): number {
  const x = oklab(a);
  const y = oklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** Two colours too alike to tell a button from the area it sits on: close in
 *  lightness AND in colour (brown buttons on teal sections are fine, navy on
 *  navy-black is not). */
const tooClose = (a: string, b: string) => contrast(a, b) < 1.5 && colorDistance(a, b) < 0.15;

/** A neutral near-black for dark areas when the brand's own shade would be
 *  indistinguishable from a dark primary (navy buttons on a navy-black header). */
const NEUTRAL_DARK = "#0b0d10";

/**
 * Each slot's colour for this palette:
 *  - a PRIMARY fill slot is always the lead's primary, exactly;
 *  - surface slots take the dark colour (or, for a template whose PRIMARY *is*
 *    its dark sections, the primary deepened until white text reads on it); a
 *    dark area that would swallow the primary-coloured buttons becomes a
 *    neutral near-black instead — the surface gives way, never the brand;
 *  - the other fills take the brand colours in the lead's order
 *    (ACCENT/SECONDARY → secondary, COMPLEMENTARY → complementary), each
 *    falling back along the list, and never the same colour as a surface.
 */
export function assignThemeSlots(slots: ThemeSlot[], p: BrandPalette): Record<string, string> {
  const out: Record<string, string> = {};
  const primaryIsFill = slots.some((s) => s.marker === "PRIMARY" && !isSurfaceSlot(s));
  const surfaces: string[] = [];
  // A template whose PRIMARY is its dark sections (AJR Contractor: "headings,
  // dark sections, nav text"): the exact primary when it is dark enough for
  // white text AND a second colour will fill the buttons; otherwise a deeper
  // shade, so buttons in the brand colour still stand out on those sections.
  const sectionShade =
    p.secondary && contrast(p.primary, "#ffffff") >= 4.5 ? p.primary : deepenFor(mix(p.primary, "#000000", 0.4), 4.5);
  for (const s of slots) {
    if (!isSurfaceSlot(s)) continue;
    let value = s.marker === "DARK" ? p.dark : sectionShade;
    if (s.marker === "DARK" && primaryIsFill && tooClose(value, p.primary) && !tooClose(NEUTRAL_DARK, p.primary)) {
      value = NEUTRAL_DARK;
    }
    out[s.name] = value;
    surfaces.push(value);
  }
  const order: Record<ThemeSlot["marker"], (string | null)[]> = {
    PRIMARY: [p.primary],
    ACCENT: [p.secondary, p.complementary, p.primary],
    SECONDARY: [p.secondary, p.complementary, p.primary],
    COMPLEMENTARY: [p.complementary, p.secondary, p.primary],
    DARK: [p.dark],
  };
  for (const s of slots) {
    if (isSurfaceSlot(s)) continue;
    if (s.marker === "PRIMARY") {
      out[s.name] = p.primary;
      continue;
    }
    const candidates = [...order[s.marker], mix(p.primary, "#ffffff", 0.3), mix(p.primary, "#ffffff", 0.5), "#ffffff"].filter(
      (c): c is string => !!c,
    );
    out[s.name] = candidates.find((c) => !surfaces.some((surface) => tooClose(c, surface))) ?? candidates[0];
  }
  return out;
}

/**
 * How a generated site will use each colour of a scheme, aligned with the
 * scheme's entries — for the lead form, so whoever types the colours sees the
 * rule (null for an entry the site won't use: unknown, or a fourth colour).
 */
export function schemeRoles(raw: string): (string | null)[] {
  const p = buildPalette(raw);
  return parseColorScheme(raw).map((entry) => {
    const hex = resolveColor(entry);
    if (!p || !hex) return null;
    if (hex === p.primary) return "Primary";
    if (hex === p.secondary) return "Secondary";
    if (hex === p.complementary) return "Complementary";
    if (p.darkFromLead && hex === p.dark) return "Dark areas";
    if (p.lights.includes(hex)) return "Background";
    return null;
  });
}

/** The roles in words, for the AI prompts (the theme itself is set in code). */
export function describePalette(p: BrandPalette): string {
  const parts = [`primary ${p.primary} (buttons, links, icons, highlights)`];
  if (p.secondary) parts.push(`secondary ${p.secondary} (accents, badges, call-to-action details)`);
  if (p.complementary) parts.push(`complementary ${p.complementary} (small extra accents)`);
  parts.push(`dark areas ${p.dark} (top bar, header, footer, dark sections)`);
  parts.push(p.lights.length ? `light areas ${p.lights.join(", ")} (backgrounds)` : "light areas white (backgrounds)");
  return parts.join("; ");
}
