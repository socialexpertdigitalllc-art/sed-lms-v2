/**
 * The fonts a logo's name can be set in — the catalogue only (no file access),
 * so the Retry popup can list it too. The files are in lib/logos/fonts/
 * (open-source: SIL Open Font License / Apache 2.0, from Google Fonts — see
 * the README there); fonts.ts loads them on the server.
 *
 * The name is TYPESET in one of these, never drawn by the image model: that
 * is what makes every letter correct and well formed.
 */

export interface LogoFontInfo {
  key: string;
  label: string;
  /** What it looks like and what it suits — for the concept writer and the picker. */
  style: string;
  /** A display face with capitals only: the name is set in upper case. */
  capsOnly?: boolean;
  /** A script face: never forced to capitals, never letter-spaced. */
  script?: boolean;
}

export const LOGO_FONTS: LogoFontInfo[] = [
  { key: "montserrat", label: "Montserrat", style: "modern geometric sans, extra bold — clean and confident, fits almost any trade" },
  { key: "poppins", label: "Poppins", style: "friendly geometric sans, bold — approachable, modern services" },
  { key: "oswald", label: "Oswald", style: "tall condensed sans, bold — strong, industrial (construction, roofing, auto)" },
  { key: "bebas", label: "Bebas Neue", style: "all-capitals condensed display — loud and sturdy (contractors, gyms, trucking)", capsOnly: true },
  { key: "archivo-black", label: "Archivo Black", style: "very heavy grotesque — punchy and bold (demolition, junk removal, sports)" },
  { key: "raleway", label: "Raleway", style: "elegant sans with fine detail — stylish (interiors, real estate, salons)" },
  { key: "playfair", label: "Playfair Display", style: "high-contrast elegant serif — premium (restaurants, law, boutiques)" },
  { key: "roboto-slab", label: "Roboto Slab", style: "sturdy slab serif — dependable and established (trades, landscaping, plumbing)" },
  { key: "lora", label: "Lora", style: "warm classic serif — trustworthy and traditional (dental, accounting, family firms)" },
  { key: "nunito", label: "Nunito", style: "rounded friendly sans — soft and caring (cleaning, pets, childcare)" },
  { key: "cinzel", label: "Cinzel", style: "classical Roman capitals — luxury and formal (law, jewellery, events)", capsOnly: true },
  { key: "pacifico", label: "Pacifico", style: "casual brush script — fun and handmade (bakery, café, ice cream, beauty)", script: true },
  { key: "exo", label: "Exo 2", style: "techy squared sans, extra bold — automotive, tech, electrical" },
  { key: "josefin", label: "Josefin Sans", style: "vintage geometric sans — boutique, barber, salon" },
  { key: "dm-serif", label: "DM Serif Display", style: "bold display serif — restaurants, boutiques, real estate" },
];

export const DEFAULT_FONT = "montserrat";

export function fontInfo(key: string | null | undefined): LogoFontInfo {
  return LOGO_FONTS.find((f) => f.key === key) ?? LOGO_FONTS.find((f) => f.key === DEFAULT_FONT)!;
}

export const isLogoFont = (key: unknown): key is string => typeof key === "string" && LOGO_FONTS.some((f) => f.key === key);
