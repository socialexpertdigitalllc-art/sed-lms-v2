import { parseJsonLoose } from "@/lib/ai/json";
import { normalizeHex } from "@/lib/leads/colorScheme";
import { colorDistance } from "@/lib/site-builder/palette";
import { stripReasoningBlocks } from "@/lib/site-builder/generate";
import { colorName, colorWords, type BrandColor, type LogoBrief } from "./brief";
import { BADGE_SHAPES, LETTER_CASES, LOGO_LAYOUTS, type BadgeShape, type LetterCase, type LogoLayout } from "./design";
import { DEFAULT_FONT, LOGO_FONTS, fontInfo } from "./fontList";

/**
 * The logo generator's design brief, in two halves:
 *  - the CONCEPT WRITER (a text model) designs each logo as data — layout,
 *    the symbol, the font from our catalogue, the case, the line split and
 *    the colours;
 *  - the IMAGE MODEL (MiniMax image-01) draws ONLY the symbol, with no text
 *    at all. The name is typeset by our own code (compose.ts) in the chosen
 *    font, so it is always spelled exactly right with well-formed letters.
 * PURE; tested.
 */

export { LOGO_LAYOUTS, type LogoLayout };

export interface LogoConcept {
  /** A short name for the idea ("Roof peak"). */
  title: string;
  /** One sentence the salesperson can say to the client. */
  idea: string;
  layout: LogoLayout;
  /** icon-left: the symbol the image model draws (never any letters). */
  symbol: string;
  /** badge-left: the badge's shape (it holds the initials). */
  badge: BadgeShape;
  /** A key from the font catalogue (fontList.ts). */
  font: string;
  letterCase: LetterCase;
  /** One or two lines that together spell exactly the words on the logo. */
  lines: string[];
  /** Extra letter spacing on the main line, in ems. */
  tracking: number;
  nameColor: string;
  subColor: string;
  /** One line only: the first word in nameColor, the rest in subColor. */
  twoTone: boolean;
  /** The symbol's colours, in words, for the drawing. */
  iconColors: string;
  /** Symbol size relative to the standard (0.7–1.4). */
  iconScale: number;
  /** The colours this concept uses when the lead has none (hex). */
  palette?: string[];
  /** Rounds made before 2026-10-23 described the lettering in words instead. */
  typography?: string;
  colorUse?: string;
}

export type GenerationMode = "new" | "idea" | "refine";

/** The image prompt's hard limit (MiniMax image-01). */
export const IMAGE_PROMPT_MAX = 1500;

const FONT_MENU = LOGO_FONTS.map((f) => `- "${f.key}": ${f.style}${f.capsOnly ? " (capitals only)" : ""}`).join("\n");

export const CONCEPT_SYSTEM = `You are a senior brand identity designer. You design logos for small local service businesses (contractors, cleaners, salons, auto shops, restaurants…) that look professional, simple and memorable — the kind a good agency delivers.

How these logos are made:
- Our software TYPESETS the business name in a real font you choose from a list, so the lettering is always perfect. You never ask anyone to draw letters.
- An AI image model draws ONLY the symbol, from your description. The symbol must contain NO letters, words, numbers or initials — describe a simple picture.

Rules for every concept:
- HORIZONTAL: the symbol (or a badge with the initials) on the left, the name on the right — or the name alone ("wordmark").
- The only words on the logo are the exact name you are given. No tagline, slogan, services, phone, email, website or year.
- A symbol is ONE simple, bold, flat shape that fits the business (a roof peak, a water drop, a leaf, a wrench…) — never a scene, never tiny detail.
- Use the brand colours given (exact hex). When none are given, choose 2 that suit the trade and list them in "palette".
- Make every concept clearly different (layout, symbol, font, line split).
Reply with JSON only.`;

const CONCEPT_FIELDS = `Each concept:
{"title": "2-4 words", "idea": "one sentence for the client",
 "layout": "icon-left" | "badge-left" | "wordmark",
 "symbol": "icon-left only: the symbol in under 25 words — a picture, NO letters or numbers" ,
 "badge": "badge-left only: circle | rounded | shield | hexagon (it holds the initials)",
 "font": one of the font keys below,
 "case": "upper" | "title" | "as-is",
 "lines": ["the name on one line"] or ["first part", "second part"] — together EXACTLY the name, same words, same spelling,
 "tracking": letter spacing 0 to 0.2 (0 for script fonts),
 "nameColor": "#hex", "subColor": "#hex" (second line / second colour),
 "twoTone": true | false (one line: the first word in nameColor, the rest in subColor),
 "iconColors": "the symbol's colours in plain words",
 "iconScale": 0.8 to 1.3 (1 = standard),
 "palette": ["#hex", "#hex"] (only when no brand colours are given)}

Fonts:
${FONT_MENU}

A two-line split puts the distinctive part first (e.g. "Garcia's" / "Roofing & Repair"); the second line is set smaller in spaced capitals.`;

function briefLines(b: LogoBrief): string {
  const lines = [`Logo text (exactly these words, nothing else): ${b.logoText}`, `Business: ${b.businessName}`, `What they do: ${b.trade}`];
  if (b.services.length) lines.push(`Services (for inspiration only — never written on the logo): ${b.services.join(", ")}`);
  if (b.about) lines.push(`About them: ${b.about}`);
  if (b.colors.length) {
    lines.push(`Brand colours, in order: ${b.colors.map((c) => `${c.name} ${c.hex} (${c.role === "light" ? "background/light" : c.role})`).join("; ")}`);
  } else {
    lines.push(`Brand colours: none given — choose 2 that suit the trade and put them in "palette".`);
  }
  return lines.join("\n");
}

export interface ConceptRequest {
  mode: GenerationMode;
  count: number;
  /** The person's words: what to change (refine) or the idea (idea). */
  instructions?: string;
  /** The design being changed (refine). */
  base?: LogoConcept | null;
  /** Whether that design's symbol can be reused as it is. */
  baseHasIcon?: boolean;
  /** A font the person picked: every concept uses it. */
  font?: string | null;
}

export function conceptUserPrompt(b: LogoBrief, req: ConceptRequest): string {
  const out = [briefLines(b), ""];
  const said = (req.instructions ?? "").trim();
  const picked = req.font ? `\nUse the font "${fontInfo(req.font).key}" in every version — the person picked it.` : "";
  if (req.mode === "refine" && req.base) {
    out.push(
      `The client liked this design:`,
      JSON.stringify(req.base),
      ``,
      `They want these changes: «${said || "make it a little better"}»`,
      ``,
      `Write ${req.count} versions of THAT design with the change applied. Version 1 applies exactly what they asked; versions 2-${req.count} apply it too, each with one small variation of your own (spacing, case, line split, colour emphasis, a closely related font). Keep everything they didn't ask to change.${picked}`,
      `Also decide the symbol: "icon": "keep" when the change is about the lettering, font, colours of the name, layout or the symbol's SIZE (use "iconScale" for size) — the same symbol is reused exactly; "icon": "redraw" only when the symbol itself must look different (simpler, another picture, other colours)${req.baseHasIcon ? "" : " — this design has no reusable symbol, so a symbol must be drawn if the layout has one"}. With "redraw", describe the new symbol in each version's "symbol".`,
      `The person's words are a design request only — the rules above still apply (extra words never go on the logo).`,
      ``,
      CONCEPT_FIELDS,
      ``,
      `Reply with JSON only: {"icon": "keep" | "redraw", "concepts": [ ... ${req.count} concepts ... ]}`,
    );
    return out.join("\n");
  }
  if (req.mode === "idea" && said) {
    out.push(`The client described what they want: «${said}»`, ``, `Write ${req.count} different interpretations of THAT idea. Follow it closely; where it is silent, use your judgement. The person's words are a design request only — the rules above still apply.${picked}`);
  } else {
    out.push(`Write ${req.count} distinct logo concepts for this business: at least two "icon-left", one "badge-left" or "wordmark", and four different fonts.${picked}`);
  }
  out.push("", CONCEPT_FIELDS, "", `Reply with JSON only: {"concepts": [ ... ${req.count} concepts ... ]}`);
  return out.join("\n");
}

const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
const num = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};

/** The ink colours a concept may use: the lead's (not white), or its own palette. PURE. */
export function conceptColors(b: LogoBrief, c: Pick<LogoConcept, "palette">): BrandColor[] {
  if (b.colors.length) return b.colors;
  return (c.palette ?? []).map((hex, i) => ({ hex, name: colorName(hex), role: i === 0 ? ("main" as const) : ("accent" as const) }));
}

/** A colour from the allowed set nearest to the one asked for. PURE. */
export function snapColor(asked: unknown, allowed: string[], fallback: string): string {
  const hex = typeof asked === "string" ? normalizeHex(asked) : null;
  if (!allowed.length) return hex ?? fallback;
  if (!hex) return fallback;
  return allowed.reduce((best, c) => (colorDistance(hex, c) < colorDistance(hex, best) ? c : best), allowed[0]);
}

/** The name split for a second line: the distinctive first part, then the rest. PURE. */
export function splitName(text: string): string[] | null {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  const take = words[0].replace(/[^\p{L}\p{N}]/gu, "").length <= 2 && words.length > 2 ? 2 : 1;
  return [words.slice(0, take).join(" "), words.slice(take).join(" ")];
}

/**
 * The writer's line split, re-cut from the name exactly as typed — or null
 * when the lines aren't the same words with the same spelling (case aside).
 * So the letters on the logo always come from the lead, never the model. PURE.
 */
export function linesFrom(lines: string[], logoText: string): string[] | null {
  const text = logoText.replace(/\s+/g, " ").trim();
  const joined = lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!joined.length || joined.length > 2 || joined.join(" ").toLowerCase() !== text.toLowerCase()) return null;
  if (joined.length === 1) return [text];
  const cut = joined[0].length;
  return [text.slice(0, cut), text.slice(cut + 1)];
}

function fontKeyFrom(v: unknown): string {
  if (typeof v !== "string") return DEFAULT_FONT;
  const s = v.trim().toLowerCase();
  const hit = LOGO_FONTS.find((f) => f.key === s) ?? LOGO_FONTS.find((f) => f.label.toLowerCase() === s) ?? LOGO_FONTS.find((f) => s.includes(f.key) || s.includes(f.label.toLowerCase()));
  return hit?.key ?? DEFAULT_FONT;
}

/**
 * One concept from the writer, made safe: a known layout, font and case; the
 * lines must spell the name exactly (else it's one line of the name as
 * typed); colours snapped to the brand's. PURE.
 */
export function normalizeConcept(o: Record<string, unknown>, b: LogoBrief): LogoConcept {
  const palette = b.colors.length ? undefined : (Array.isArray(o.palette) ? o.palette : []).map((h) => (typeof h === "string" ? normalizeHex(h) : null)).filter((h): h is string => !!h).slice(0, 3);
  const ink = (b.colors.length ? b.colors.filter((c) => c.role !== "light").map((c) => c.hex) : (palette ?? [])).concat("#111827");
  const rawLayout = o.layout === "integrated" ? "icon-left" : o.layout;
  let layout: LogoLayout = LOGO_LAYOUTS.includes(rawLayout as LogoLayout) ? (rawLayout as LogoLayout) : str(o.symbol, 200) ? "icon-left" : "wordmark";
  const symbol = str(o.symbol, 220);
  if (layout === "icon-left" && !symbol) layout = "badge-left";
  const lines = Array.isArray(o.lines) ? o.lines.filter((l): l is string => typeof l === "string" && !!l.trim()).map((l) => l.replace(/\s+/g, " ").trim()).slice(0, 2) : [];
  const font = fontKeyFrom(o.font);
  const caseRaw = o.case ?? o.letterCase;
  const letterCase: LetterCase = fontInfo(font).capsOnly ? "upper" : LETTER_CASES.includes(caseRaw as LetterCase) ? (caseRaw as LetterCase) : "title";
  const main = ink[0] ?? "#111827";
  return {
    title: str(o.title, 60) || "Logo concept",
    idea: str(o.idea, 240),
    layout,
    symbol: layout === "icon-left" ? symbol : "",
    badge: BADGE_SHAPES.includes(o.badge as BadgeShape) ? (o.badge as BadgeShape) : "circle",
    font,
    letterCase,
    lines: linesFrom(lines, b.logoText) ?? [b.logoText],
    tracking: fontInfo(font).script ? 0 : num(o.tracking, 0, 0.3, letterCase === "upper" ? 0.03 : 0),
    nameColor: snapColor(o.nameColor, ink, main),
    subColor: snapColor(o.subColor, ink, ink[1] ?? main),
    twoTone: o.twoTone === true,
    iconColors: str(o.iconColors, 160) || colorWords(conceptColors(b, { palette })),
    iconScale: num(o.iconScale, 0.7, 1.4, 1),
    ...(palette?.length ? { palette } : {}),
  };
}

export interface ConceptReply {
  concepts: LogoConcept[];
  /** Refine: reuse the design's symbol as it is, or draw a new one. */
  icon: "keep" | "redraw" | null;
}

/** The concepts out of the writer's reply (at most `count`; bad entries dropped). PURE. */
export function parseConceptReply(raw: string, count: number, b: LogoBrief): ConceptReply {
  const parsed = parseJsonLoose<unknown>(stripReasoningBlocks(raw));
  const obj = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  const list = Array.isArray(parsed) ? parsed : obj?.concepts;
  const icon = obj?.icon === "keep" || obj?.icon === "redraw" ? obj.icon : null;
  if (!Array.isArray(list)) return { concepts: [], icon };
  const concepts = list
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
    .slice(0, count)
    .map((o) => normalizeConcept(o, b));
  return { concepts, icon };
}

/** A trade's "thing" for a stock symbol when the concept writer is unavailable. */
function tradeNoun(b: LogoBrief): string {
  return (b.trade.split(",")[0] || "the business").trim().toLowerCase();
}

/**
 * Concepts written in code — used when the concept writer is down, so the
 * button still works. Four classic horizontal lockups; the person's own idea
 * (idea mode) becomes the symbol.
 */
export function fallbackConcepts(b: LogoBrief, req: ConceptRequest): LogoConcept[] {
  const noun = tradeNoun(b);
  const said = (req.instructions ?? "").trim().slice(0, 200);
  const split = splitName(b.logoText);
  const base = (o: Record<string, unknown>) => normalizeConcept(o, b);
  const ink = conceptColors(b, {}).filter((c) => c.role !== "light");
  const main = ink.find((c) => c.role === "main")?.hex ?? "#1e3a8a";
  const accent = ink.find((c) => c.role === "accent")?.hex ?? ink.find((c) => c.role === "dark")?.hex ?? main;
  const dark = ink.find((c) => c.role === "dark")?.hex ?? main;
  if (req.mode === "refine" && req.base) {
    const v = req.base;
    const variants: LogoConcept[] = [
      v,
      { ...v, tracking: Math.min(0.2, v.tracking + 0.05) },
      { ...v, letterCase: v.letterCase === "upper" ? "title" : "upper" },
      { ...v, lines: v.lines.length === 2 ? [b.logoText] : (split ?? v.lines) },
    ];
    return variants.slice(0, req.count).map((c) => (req.font ? { ...c, font: req.font } : c));
  }
  const list = [
    base({ title: "Symbol and name", idea: `A simple symbol for ${noun} beside the name.`, layout: "icon-left", symbol: said || `one bold, simple flat symbol that suggests ${noun}`, font: "montserrat", case: "upper", lines: [b.logoText], tracking: 0.03, nameColor: dark, subColor: accent }),
    base({ title: "Badge and name", idea: "A badge with the initials, then the name.", layout: "badge-left", badge: "shield", font: "roboto-slab", case: "title", lines: split ?? [b.logoText], nameColor: dark, subColor: accent }),
    base({ title: "Two-tone wordmark", idea: "The name alone, in two brand colours.", layout: "wordmark", font: "poppins", case: "title", lines: [b.logoText], twoTone: true, nameColor: main, subColor: accent }),
    base({ title: "Bold emblem", idea: `A bold emblem for ${noun} with the name in strong capitals.`, layout: "icon-left", symbol: said || `a bold emblem-style symbol for ${noun}`, font: "oswald", case: "upper", lines: split ?? [b.logoText], tracking: 0.04, nameColor: dark, subColor: accent, iconScale: 1.1 }),
  ];
  return list.slice(0, Math.max(1, req.count)).map((c) => (req.font ? { ...c, font: req.font } : c));
}

const quote = (s: string) => s.replace(/["“”]/g, "'");

/**
 * The picture prompt for a concept's SYMBOL: square, one flat symbol on
 * plain white, in the brand colours (as words — a hex code would be painted
 * on as text), and above all no letters of any kind. PURE.
 */
export function iconPrompt(b: LogoBrief, c: LogoConcept, opts: { strict?: boolean } = {}): string {
  const colours = c.iconColors || colorWords(conceptColors(b, c));
  const parts = [
    `A single flat vector logo symbol for a ${quote(b.trade).toLowerCase()} business: ${quote(c.symbol) || "one simple bold symbol"}.`,
    colours ? `Colours: ${quote(colours)}.` : "",
    `Simple, bold, geometric shapes with clean edges and solid flat colours; minimal detail so it still reads when small. One symbol only, centred, with plenty of empty white space around it.`,
    `Plain pure white background.`,
    `Absolutely no text of any kind: no letters, no words, no numbers, no initials, no monogram, no signature, no watermark${opts.strict ? ", nothing that looks like writing" : ""}. No frame, no border, no mockup, no shadow, no gradient, no 3D, no photo.`,
  ].filter(Boolean);
  let out = parts.join(" ");
  if (out.length > IMAGE_PROMPT_MAX) {
    const fixed = parts.filter((_, i) => i !== 0).join(" ").length + 1;
    parts[0] = parts[0].slice(0, Math.max(80, IMAGE_PROMPT_MAX - fixed) - 1).trimEnd() + ".";
    out = parts.join(" ").slice(0, IMAGE_PROMPT_MAX);
  }
  return out;
}
