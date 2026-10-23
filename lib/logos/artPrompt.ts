import { parseJsonLoose } from "@/lib/ai/json";
import { stripReasoningBlocks } from "@/lib/site-builder/generate";
import { colorName, type LogoBrief } from "./brief";
import { initialsFor } from "./compose";
import { fontInfo } from "./fontList";
import { normalizeHex } from "@/lib/leads/colorScheme";

/**
 * Art direction for COMPLETE logos designed by Google's image model (Nano
 * Banana Pro): a creative director (the concept writer) briefs four distinct,
 * agency-grade logos — a real graphic idea, the lettering, the colours — and
 * Google draws each one whole, name included. The name is quoted exactly and
 * the result is read back (check.ts) and corrected if it came out wrong.
 * PURE; tested.
 */

export interface ArtStyle {
  key: string;
  label: string;
  guide: string;
}

export const ART_STYLES: ArtStyle[] = [
  { key: "combination", label: "Symbol + name", guide: "a distinctive custom symbol beside the name — a clever idea (negative space, two motifs merged into one, precise geometric construction), never a plain stock icon" },
  { key: "emblem", label: "Emblem", guide: "a horizontal crest, shield or badge that holds the name together with a refined illustrated motif — strong, established, premium" },
  { key: "lettermark", label: "Monogram + name", guide: "the initials crafted into a bold, custom monogram mark (interlocked or built from the trade's motif), beside the full name" },
  { key: "abstract", label: "Abstract mark", guide: "an abstract geometric mark that expresses the business's character (motion, precision, care, strength), beside the name" },
  { key: "mascot", label: "Mascot", guide: "a friendly, well-crafted illustrated character or animal mark beside the name — for food, pets, kids, cleaning and other warm brands" },
  { key: "wordmark", label: "Custom wordmark", guide: "the name in custom, characterful lettering with one graphic idea built into a letter or between the words" },
];

export interface ArtConcept {
  title: string;
  idea: string;
  style: string;
  /** The art direction for the image model: the graphic, composition, finish. */
  brief: string;
  /** The lettering: weight, serif/sans/script, case, spacing. */
  typography: string;
}

export const ART_CONCEPT_SYSTEM = `You are the creative director of an award-winning branding agency. You brief an AI designer (Google's best image model) that draws COMPLETE logos — the graphic AND the business name — for small local businesses (contractors, cleaners, salons, auto shops, restaurants, clinics…).

Your logos must look like real, professional brand identities — distinctive, memorable, polished, the kind a client pays an agency for. Never clip-art, never a plain generic icon (a basic house, a wrench, a tooth, a leaf) placed next to text. When the trade has an obvious symbol, reinvent it: merge it with a second idea, use negative space, build it from the initials, give it precise geometric construction or a crafted illustration style.

Rules for every logo:
- HORIZONTAL lockup (wider than tall): graphic beside the name, or a horizontal emblem that holds the name.
- The ONLY words are the exact business name given. No tagline, slogan, services, phone, email, website or year.
- Flat vector finish, crisp edges, 1–3 brand colours (white allowed), readable when small.
- The four logos must be clearly different: different styles, graphic ideas and lettering.
Reply with JSON only.`;

function briefLines(b: LogoBrief): string {
  const lines = [`Business name (exactly, nothing else is written): ${b.logoText}`, `What they do: ${b.trade}`];
  if (b.services.length) lines.push(`Services (inspiration only — never written): ${b.services.join(", ")}`);
  if (b.about) lines.push(`About them: ${b.about}`);
  lines.push(b.colors.length ? `Brand colours: ${colorList(b)}` : `Brand colours: none given — choose 2 that suit the trade.`);
  return lines.join("\n");
}

const STYLE_MENU = ART_STYLES.map((s) => `- "${s.key}": ${s.guide}`).join("\n");

const ART_FIELDS = `Each logo:
{"title": "2-4 words", "idea": "one sentence a salesperson can say to the client",
 "style": one of the style keys,
 "brief": "the art direction for the designer, 40-90 words: the graphic idea in concrete visual terms, how it is drawn (line weight, geometry, illustration style), composition, which colour goes where — do NOT write the business name in it",
 "typography": "the lettering in under 25 words: weight, serif/sans/script, case, spacing, any custom touch"}

Styles:
${STYLE_MENU}`;

export function artConceptPrompt(b: LogoBrief, req: { count: number; instructions?: string; font?: string | null }): string {
  const out = [briefLines(b), ""];
  const said = (req.instructions ?? "").trim();
  if (said) out.push(`The client described what they want: «${said}»`, `Write ${req.count} different interpretations of THAT idea. It is a design request only — the rules still apply.`);
  else out.push(`Write ${req.count} logos in ${req.count} different styles.`);
  if (req.font) out.push(`Set the name in lettering like ${fontInfo(req.font).label} (${fontInfo(req.font).style.split(" — ")[0]}) in every logo — the client picked it.`);
  out.push("", ART_FIELDS, "", `Reply with JSON only: {"concepts": [ ... ${req.count} logos ... ]}`);
  return out.join("\n");
}

const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

export function parseArtConcepts(raw: string, count: number): ArtConcept[] {
  const parsed = parseJsonLoose<unknown>(stripReasoningBlocks(raw));
  const list = Array.isArray(parsed) ? parsed : (parsed as { concepts?: unknown } | null)?.concepts;
  if (!Array.isArray(list)) return [];
  return list
    .filter((o): o is Record<string, unknown> => !!o && typeof o === "object" && !Array.isArray(o))
    .map((o) => ({
      title: str(o.title, 60) || "Logo concept",
      idea: str(o.idea, 240),
      style: ART_STYLES.some((s) => s.key === o.style) ? (o.style as string) : "combination",
      brief: str(o.brief, 700),
      typography: str(o.typography, 200),
    }))
    .filter((c) => c.brief)
    .slice(0, count);
}

function tradeNoun(b: LogoBrief): string {
  return (b.trade.split(",")[0] || "the business").trim().toLowerCase();
}

/** Four agency-style briefs written in code, for when the concept writer is down. */
export function fallbackArtConcepts(b: LogoBrief, req: { count: number; instructions?: string }): ArtConcept[] {
  const noun = tradeNoun(b);
  const said = (req.instructions ?? "").trim().slice(0, 200);
  const idea = said ? ` inspired by: ${said}` : "";
  const initials = initialsFor(b.logoText);
  const list: ArtConcept[] = [
    { title: "Clever symbol", idea: `A custom ${noun} symbol with a clever twist beside the name.`, style: "combination", brief: `A distinctive symbol for a ${noun} business${idea}: two ideas merged into one mark with smart use of negative space, precise geometric construction and confident line weights, placed to the left of the name.`, typography: "bold modern geometric sans-serif, clean and well spaced" },
    { title: "Premium emblem", idea: "A strong horizontal emblem that holds the name.", style: "emblem", brief: `A horizontal shield-and-banner emblem with a refined ${noun} illustration${idea}, crisp linework and balanced details, the name set inside the banner.`, typography: "strong slab serif in capitals" },
    { title: "Monogram", idea: `A crafted ${initials} monogram beside the full name.`, style: "lettermark", brief: `A custom monogram of the letters ${initials}${idea}, interlocked and built from clean geometric strokes inside a subtle shape, to the left of the name.`, typography: "elegant sans-serif, generous letter spacing" },
    { title: "Signature wordmark", idea: "The name in custom lettering with one graphic touch.", style: "wordmark", brief: `The name in custom lettering with a ${noun} motif cleverly built into one letter${idea}; nothing else beside it.`, typography: "characterful custom lettering, bold, title case" },
  ];
  return list.slice(0, Math.max(1, req.count));
}

export function colorList(b: LogoBrief, palette?: string[]): string {
  const colours = b.colors.length ? b.colors.map((c) => ({ hex: c.hex, name: c.name })) : (palette ?? []).map((h) => normalizeHex(h)).filter((h): h is string => !!h).map((hex) => ({ hex, name: colorName(hex) }));
  return colours.map((c) => `${c.name} (${c.hex.toUpperCase()})`).join(", ");
}

const quote = (s: string) => s.replace(/["“”]/g, "'");

/** The full picture prompt for one complete logo. PURE. */
export function artImagePrompt(b: LogoBrief, c: ArtConcept, opts: { font?: string | null } = {}): string {
  const name = quote(b.logoText);
  const style = ART_STYLES.find((s) => s.key === c.style) ?? ART_STYLES[0];
  const typography = opts.font ? `in lettering like ${fontInfo(opts.font).label} (${fontInfo(opts.font).style.split(" — ")[0]})` : c.typography ? `— ${quote(c.typography)}` : "";
  const colours = colorList(b);
  return [
    `Design a professional logo for "${name}", a ${quote(b.trade).toLowerCase()} business. It must look like the work of a top branding agency: distinctive, memorable, polished — not clip-art, not a generic icon.`,
    `Concept: ${quote(c.brief)}`,
    `Style: ${style.guide}.`,
    `Lettering: the only text in the image is the business name "${name}", spelled exactly like that, letter for letter, written once ${typography}.`,
    colours ? `Colours: ${colours}; never write the colour codes.` : `Colours: two colours that suit the trade.`,
    `Format: a horizontal logo (wider than tall), centred on a plain pure white background with generous empty margin all around; crisp flat vector artwork with clean edges that still reads when small.`,
    `Do not add: a tagline, slogan, services, phone number, email, website, address, year or any other words or letters; no mockup, photo, 3D render, drop shadow, texture, frame or watermark.`,
  ].join("\n");
}

/** Ask Google to fix the lettering of a design it drew. PURE. */
export function fixLetteringPrompt(b: LogoBrief, read: string): string {
  const name = quote(b.logoText);
  return [
    `This is a logo design. Its lettering is wrong — it reads "${quote(read) || "something else"}".`,
    `Redraw only the lettering so it reads exactly "${name}" — every letter correct, the same lettering style, weight, size, colour and position.`,
    `Keep the graphic, layout and colours exactly as they are. Plain pure white background. No other words.`,
  ].join("\n");
}

/** Ask Google to change a chosen design as the person asked, keeping the rest. PURE. */
export function refineArtPrompt(b: LogoBrief, instructions: string, version: number, opts: { font?: string | null } = {}): string {
  const name = quote(b.logoText);
  const lines = [
    `Edit this logo for "${name}".`,
    `Change: ${quote(instructions) || "polish it"}.`,
    `Keep everything else exactly the same — the same graphic, layout, colours and lettering — unless the change asks otherwise.`,
  ];
  if (opts.font) lines.push(`Set the name in lettering like ${fontInfo(opts.font).label} (${fontInfo(opts.font).style.split(" — ")[0]}).`);
  lines.push(`The only text must still be "${name}", spelled exactly, written once. Horizontal logo, crisp flat vector artwork, plain pure white background. No tagline or other words.`);
  if (version > 0) lines.push(`This is version ${version + 1} of 4: give the change a slightly different interpretation from the most obvious one.`);
  return lines.join("\n");
}
