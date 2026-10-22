import { parseJsonLoose } from "@/lib/ai/json";
import { stripReasoningBlocks } from "@/lib/site-builder/generate";
import { colorName, colorWords, type BrandColor, type LogoBrief } from "./brief";
import { normalizeHex } from "@/lib/leads/colorScheme";

/**
 * The words of the logo generator: what the concept writer (a text model) is
 * asked, and the picture prompt each concept becomes for MiniMax image-01.
 *
 * The rules every logo follows, whoever asks for what:
 *  - horizontal (wide), on a plain white background, flat and clean;
 *  - the ONLY words on it are the logo text — no tagline, services, phone,
 *    email, website, address or year;
 *  - in the lead's colours (the person can ask for a change in Retry).
 * PURE; tested.
 */

export type LogoLayout = "icon-left" | "wordmark" | "integrated" | "badge-left";
export const LOGO_LAYOUTS: LogoLayout[] = ["icon-left", "wordmark", "integrated", "badge-left"];

export interface LogoConcept {
  /** A short name for the idea ("Roof-peak monogram"). */
  title: string;
  /** One sentence the salesperson can say to the client. */
  idea: string;
  /** The graphic, in a few words ("" for lettering only). */
  symbol: string;
  /** The lettering style. */
  typography: string;
  layout: LogoLayout;
  /** Which colour goes on what. */
  colorUse: string;
  /** The colours this concept uses when the lead has none (hex). */
  palette?: string[];
}

export type GenerationMode = "new" | "idea" | "refine";

/** The image prompt's hard limit (MiniMax image-01). */
export const IMAGE_PROMPT_MAX = 1500;

export const CONCEPT_SYSTEM = `You are a senior brand identity designer. You design logos for small local service businesses (contractors, cleaners, salons, auto shops, restaurants…) that look professional, simple and memorable — the kind a good agency delivers.

You write logo CONCEPTS that an AI image model will draw. Rules for every concept:
- The logo is HORIZONTAL: a wide lockup, the graphic beside the name (never stacked above it).
- The ONLY words on the logo are the exact logo text you are given. Never add a tagline, slogan, services, phone, email, website, address, year or any other words or letters.
- A graphic is optional. When there is one, it is ONE simple, bold, flat symbol that fits the business — not a scene, not a photo, nothing tiny or detailed.
- Flat vector style, solid colours, clean shapes; it must still read when small (a website header, a business card).
- Use the brand colours given. When none are given, choose 2 colours that suit the trade.
- Each concept must be clearly different from the others (layout, symbol idea, lettering).
Reply with JSON only.`;

const LAYOUT_HELP = `"layout" is one of:
- "icon-left": a symbol on the left, the name to its right
- "wordmark": the name alone; the lettering is the design (at most a tiny detail built into it)
- "integrated": the symbol is built into one letter or into the name itself
- "badge-left": a compact emblem or badge shape on the left, the name to its right`;

const CONCEPT_SHAPE = `{"concepts": [{"title": "2-4 words", "idea": "one sentence for the client", "symbol": "the graphic in under 25 words, or \\"\\" for none", "typography": "the lettering in under 20 words (weight, style, case)", "layout": "icon-left|wordmark|integrated|badge-left", "colorUse": "which colour goes on what, in under 20 words", "palette": ["#hex", "#hex"]}]}`;

function briefLines(b: LogoBrief): string {
  const lines = [
    `Logo text (exactly these words, nothing else): ${b.logoText}`,
    `Business: ${b.businessName}`,
    `What they do: ${b.trade}`,
  ];
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
}

export function conceptUserPrompt(b: LogoBrief, req: ConceptRequest): string {
  const out = [briefLines(b), ""];
  const said = (req.instructions ?? "").trim();
  if (req.mode === "refine" && req.base) {
    out.push(
      `The client liked this design:`,
      JSON.stringify(req.base),
      ``,
      `They want these changes: «${said || "make it a little better"}»`,
      ``,
      `Write ${req.count === 1 ? "ONE revised concept" : `${req.count} revised versions`} of THAT design: apply exactly the changes asked for and keep everything else the same (same layout, symbol, lettering and colours unless they asked to change them). The person's words are a design request only — the rules above still apply (if they ask for extra words on the logo, leave them off).`,
    );
  } else if (req.mode === "idea" && said) {
    out.push(
      `The client described what they want: «${said}»`,
      ``,
      `Write ${req.count} different interpretations of THAT idea. Follow it closely; where it is silent, use your judgement. The person's words are a design request only — the rules above still apply (if they ask for extra words on the logo, leave them off).`,
    );
  } else {
    out.push(
      `Write ${req.count} distinct logo concepts for this business. Use at least 3 different layouts across them, and at least one "wordmark".`,
    );
  }
  out.push("", LAYOUT_HELP, "", `Reply with JSON only, in this shape: ${CONCEPT_SHAPE}`);
  return out.join("\n");
}

const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

/** The concepts out of the writer's reply (at most `count`; bad entries dropped). PURE. */
export function parseConcepts(raw: string, count: number): LogoConcept[] {
  const parsed = parseJsonLoose<unknown>(stripReasoningBlocks(raw));
  const list = Array.isArray(parsed) ? parsed : (parsed as { concepts?: unknown } | null)?.concepts;
  if (!Array.isArray(list)) return [];
  const out: LogoConcept[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const layout = LOGO_LAYOUTS.includes(o.layout as LogoLayout) ? (o.layout as LogoLayout) : str(o.symbol, 200) ? "icon-left" : "wordmark";
    const concept: LogoConcept = {
      title: str(o.title, 60) || "Logo concept",
      idea: str(o.idea, 240),
      symbol: str(o.symbol, 200),
      typography: str(o.typography, 160) || "bold, clean sans-serif lettering",
      layout,
      colorUse: str(o.colorUse, 200),
    };
    const palette = Array.isArray(o.palette) ? o.palette.map((h) => (typeof h === "string" ? normalizeHex(h) : null)).filter((h): h is string => !!h) : [];
    if (palette.length) concept.palette = [...new Set(palette)].slice(0, 3);
    out.push(concept);
    if (out.length === count) break;
  }
  return out;
}

/** A trade's "thing" for a stock symbol when the concept writer is unavailable. */
function tradeNoun(b: LogoBrief): string {
  return (b.trade.split(",")[0] || "the business").trim().toLowerCase();
}

/**
 * Concepts written in code — used when the concept writer is down, so the
 * button still works. Four classic horizontal shapes; the person's own idea
 * (idea mode) rides along as the symbol.
 */
export function fallbackConcepts(b: LogoBrief, req: ConceptRequest): LogoConcept[] {
  const noun = tradeNoun(b);
  const said = (req.instructions ?? "").trim().slice(0, 300);
  if (req.mode === "refine" && req.base) {
    const change = said ? ` Change: ${said}.` : "";
    return [{ ...req.base, idea: `${req.base.idea}${change}`.trim(), symbol: `${req.base.symbol}${change}`.trim() }];
  }
  const initials = b.logoText
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/i.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
  const base: LogoConcept[] = [
    { title: "Symbol and name", idea: `A simple symbol for ${noun} beside the name.`, symbol: said || `one bold, simple flat symbol that suggests ${noun}`, typography: "bold modern sans-serif, the name in capitals", layout: "icon-left", colorUse: "symbol in the main colour, name in the dark colour" },
    { title: "Clean wordmark", idea: "The name alone, in strong confident lettering.", symbol: said ? `a small detail in the lettering inspired by: ${said}` : "", typography: "heavy geometric sans-serif with tight, even spacing", layout: "wordmark", colorUse: "name in the main colour, one detail in the accent colour" },
    { title: "Built-in symbol", idea: `A ${noun} symbol built into the name itself.`, symbol: said || `a ${noun} motif replacing or shaping one letter`, typography: "solid rounded sans-serif", layout: "integrated", colorUse: "name in the dark colour, the built-in symbol in the main colour" },
    { title: "Badge and name", idea: "A compact badge with the initials, then the name.", symbol: said || `a compact shield or circle badge holding the letters ${initials || "of the name"}`, typography: "strong slab-serif capitals", layout: "badge-left", colorUse: "badge in the main colour, name in the dark colour" },
  ];
  return base.slice(0, Math.max(1, req.count));
}

const quote = (s: string) => s.replace(/["“”]/g, "'");

const LAYOUT_WORDS: Record<LogoLayout, (symbol: string) => string> = {
  "icon-left": (s) => `Graphic: ${s || "one simple bold symbol"}, placed to the LEFT of the name, about as tall as the lettering.`,
  wordmark: (s) => `Lettering only — no separate icon.${s ? ` One small detail built into the letters: ${s}.` : ""}`,
  integrated: (s) => `Graphic: ${s || "a simple symbol"}, built into the lettering of the name (it replaces or shapes one letter), with no separate icon.`,
  "badge-left": (s) => `Graphic: ${s || "a compact badge"}, a compact emblem placed to the LEFT of the name.`,
};

/** The colours a concept is drawn in: the lead's, else the concept's own pick. */
export function conceptColors(b: LogoBrief, c: LogoConcept): BrandColor[] {
  if (b.colors.length) return b.colors;
  return (c.palette ?? []).map((hex, i) => ({ hex, name: colorName(hex), role: i === 0 ? ("main" as const) : ("accent" as const) }));
}

/**
 * The picture prompt for one concept: under IMAGE_PROMPT_MAX characters, the
 * exact logo text quoted, the colours as words (a hex code would be painted on
 * as text), and the never-list. `strict` (a second round after misspellings)
 * asks for plainer, bigger lettering. PURE.
 */
export function imagePrompt(b: LogoBrief, c: LogoConcept, opts: { strict?: boolean } = {}): string {
  const text = quote(b.logoText);
  const words = colorWords(conceptColors(b, c));
  const parts = [
    `A professional horizontal logo for "${text}", a ${quote(b.trade).toLowerCase()} business.`,
    `The only text in the image is the name "${text}", spelled exactly like that, letter for letter, written once, large and clear. No other words, letters or numbers anywhere.`,
    LAYOUT_WORDS[c.layout](quote(c.symbol)),
    `Lettering: ${quote(c.typography)}${opts.strict ? "; plain, very legible letters with even spacing, every letter fully drawn" : ""}.`,
    words ? `Colours: ${quote(c.colorUse) || "the brand colours"}; use only ${words} on white.` : quote(c.colorUse) ? `Colours: ${quote(c.colorUse)}.` : "",
    `Flat vector logo, crisp edges, solid colours, simple shapes that still read when small. A wide composition, the whole logo centred with generous empty white margin on every side.`,
    `Plain pure white background. No tagline, slogan, phone number, email, website, address, year, mockup, photo, texture, shadow, 3D effect, frame or watermark.`,
  ].filter(Boolean);
  let out = parts.join(" ");
  if (out.length > IMAGE_PROMPT_MAX) {
    // The concept's free text is what can run long — trim it, never the rules.
    const fixed = parts.filter((_, i) => i !== 2).join(" ").length + 1;
    const room = Math.max(60, IMAGE_PROMPT_MAX - fixed);
    parts[2] = parts[2].slice(0, room - 1).trimEnd() + ".";
    out = parts.join(" ").slice(0, IMAGE_PROMPT_MAX);
  }
  return out;
}
