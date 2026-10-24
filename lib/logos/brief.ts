import { colorDistance, isDarkColor, isLightColor, luminance, resolveSchemeColors, saturation } from "@/lib/site-builder/palette";

/**
 * What the logo generator knows about a business, taken from the lead — and
 * nothing else. The logo shows the NAME (and a graphic if it helps); the
 * services, the area and the trade only steer the design, they are never
 * written on it. PURE; tested.
 */

/** Legal endings a logo leaves off ("ABC Roofing LLC" → "ABC Roofing"). */
const LEGAL_SUFFIX = /[\s,]+(l\.?\s?l\.?\s?c\.?|p\.?\s?l\.?\s?l\.?\s?c\.?|l\.?\s?l\.?\s?p\.?|inc\.?|incorporated|corp\.?|corporation|ltd\.?|limited)\s*$/i;

/** The words that go on the logo: the business name without its legal ending. */
export function logoTextFor(businessName: string): string {
  let name = businessName.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 2 && LEGAL_SUFFIX.test(name); i++) name = name.replace(LEGAL_SUFFIX, "").trim();
  return name.replace(/[\s,]+$/, "") || businessName.trim();
}

/** Letters and digits only, upper case, "&" read as AND — how two spellings are compared. */
export function nameKey(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, "");
}

/** Descriptive names an image model paints well. Hex codes are never sent to it (it would letter them). */
const COLOR_NAMES: [string, string][] = [
  ["jet black", "#111111"], ["charcoal grey", "#2b2f33"], ["slate grey", "#475569"], ["steel grey", "#6b7280"], ["silver grey", "#a8a9ad"], ["light grey", "#d1d5db"],
  ["white", "#ffffff"], ["ivory", "#fffff0"], ["cream", "#fdf6e3"], ["beige", "#efe6d2"], ["sand", "#d8c3a5"], ["tan", "#c8a27a"],
  ["bright red", "#dc2626"], ["deep red", "#991b1b"], ["crimson", "#be123c"], ["maroon", "#7f1d1d"], ["burgundy", "#7f1d2d"], ["scarlet", "#ff2400"],
  ["coral", "#f97352"], ["salmon pink", "#fa8072"], ["peach", "#fdba74"], ["rust orange", "#b7410e"], ["terracotta", "#c2603f"],
  ["bright orange", "#ea580c"], ["burnt orange", "#c2410c"], ["tangerine", "#f97316"], ["amber", "#f59e0b"], ["golden yellow", "#facc15"],
  ["mustard yellow", "#e1ad01"], ["metallic gold", "#d4af37"], ["lemon yellow", "#fde047"],
  ["lime green", "#65a30d"], ["bright green", "#22c55e"], ["kelly green", "#15803d"], ["forest green", "#166534"], ["dark green", "#14532d"],
  ["olive green", "#6b7a1f"], ["sage green", "#8a9a5b"], ["mint green", "#6ee7b7"], ["emerald green", "#059669"], ["teal", "#0f766e"],
  ["turquoise", "#14b8a6"], ["cyan", "#06b6d4"], ["sky blue", "#38bdf8"], ["light blue", "#60a5fa"], ["baby blue", "#93c5fd"],
  ["royal blue", "#2563eb"], ["bright blue", "#1d4ed8"], ["cobalt blue", "#0047ab"], ["sapphire blue", "#0f52ba"], ["navy blue", "#1e3a8a"],
  ["midnight navy", "#172554"], ["indigo", "#4338ca"], ["violet", "#8b5cf6"], ["purple", "#7e22ce"], ["deep purple", "#581c87"],
  ["lavender", "#c4b5fd"], ["plum", "#8e4585"], ["magenta", "#c026d3"], ["hot pink", "#ec4899"], ["pink", "#db2777"], ["rose", "#e11d48"],
  ["blush pink", "#f9a8d4"], ["chocolate brown", "#7b3f00"], ["brown", "#7c4a1e"], ["dark brown", "#4a2c12"], ["bronze", "#a97142"],
  ["copper", "#b87333"], ["khaki", "#c3b091"],
];

/** The nearest descriptive name for a colour ("#1F3B8C" → "navy blue"). PURE. */
export function colorName(hex: string): string {
  let best = COLOR_NAMES[0];
  let bestD = Infinity;
  for (const entry of COLOR_NAMES) {
    const d = colorDistance(hex, entry[1]);
    if (d < bestD) {
      bestD = d;
      best = entry;
    }
  }
  return best[0];
}

export interface BrandColor {
  hex: string;
  name: string;
  /** How a logo uses it. */
  role: "main" | "accent" | "dark" | "light";
}

export interface LogoBrief {
  businessName: string;
  /** Exactly the words that go on the logo. */
  logoText: string;
  /** What the business does, in a few words (steers the graphic; never written). */
  trade: string;
  services: string[];
  about: string;
  /** The lead's colours in its own order; empty = none on the lead (the designer picks). */
  colors: BrandColor[];
}

export interface LeadForBrief {
  business_name: string;
  services?: string[] | null;
  category?: string | null;
  about_business?: string | null;
  color_scheme?: string | null;
}

/** The lead's colours, each with a name and a role on a logo. PURE. */
export function brandColors(raw: string | null | undefined): BrandColor[] {
  const hexes = resolveSchemeColors(raw).slice(0, 4);
  const solid = hexes.filter((h) => !isLightColor(h));
  const brand = solid.filter((h) => !isDarkColor(h));
  return hexes.map((hex) => {
    let role: BrandColor["role"];
    if (isLightColor(hex)) role = "light";
    else if (isDarkColor(hex)) role = brand.length ? "dark" : "main";
    else role = hex === brand[0] ? "main" : "accent";
    return { hex, name: colorName(hex), role };
  });
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function logoBrief(lead: LeadForBrief, logoText?: string | null): LogoBrief {
  const services = (lead.services ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 8);
  const trade = (lead.category ?? "").trim() || services.slice(0, 3).join(", ") || "local business";
  return {
    businessName: lead.business_name.trim(),
    logoText: (logoText ?? "").replace(/\s+/g, " ").trim() || logoTextFor(lead.business_name),
    trade: clip(trade, 120),
    services,
    about: clip((lead.about_business ?? "").replace(/\s+/g, " ").trim(), 600),
    colors: brandColors(lead.color_scheme),
  };
}

/** The colours in plain words for the image model ("navy blue and bright orange, on white"). PURE. */
export function colorWords(colors: BrandColor[]): string {
  const ink = colors.filter((c) => c.role !== "light");
  if (!ink.length) return "";
  const names = [...new Set(ink.map((c) => c.name))];
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** A colour vivid enough to read as the brand colour in a picture (used by the colour check). */
export const isInk = (hex: string) => !isLightColor(hex) && (saturation(hex) > 0.18 || luminance(hex) < 0.2);
