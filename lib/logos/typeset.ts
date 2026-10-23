import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { create, type Font } from "fontkit";
import { DEFAULT_FONT, fontInfo } from "./fontList";
import type { LetterCase } from "./design";

/**
 * The business name, set in a real font and turned into vector outlines —
 * so every letter is spelled exactly as typed and perfectly formed. (Image
 * models misspell names and draw broken letters; they only ever draw the
 * symbol now.) Outlines, not <text>: the picture renders the same on any
 * server, with no installed fonts needed.
 */

/** Primary face (bold) and companion (the smaller second line) for each catalogue key. */
const FILES: Record<string, { main: string; companion: string }> = {
  montserrat: { main: "montserrat-800.ttf", companion: "montserrat-600.ttf" },
  poppins: { main: "poppins-700.ttf", companion: "poppins-500.ttf" },
  oswald: { main: "oswald-700.ttf", companion: "montserrat-600.ttf" },
  bebas: { main: "bebas-neue-400.ttf", companion: "montserrat-600.ttf" },
  "archivo-black": { main: "archivo-black-400.ttf", companion: "montserrat-600.ttf" },
  raleway: { main: "raleway-700.ttf", companion: "raleway-500.ttf" },
  playfair: { main: "playfair-display-700.ttf", companion: "montserrat-600.ttf" },
  "roboto-slab": { main: "roboto-slab-700.ttf", companion: "montserrat-600.ttf" },
  lora: { main: "lora-700.ttf", companion: "lora-500.ttf" },
  nunito: { main: "nunito-800.ttf", companion: "poppins-500.ttf" },
  cinzel: { main: "cinzel-700.ttf", companion: "lora-500.ttf" },
  pacifico: { main: "pacifico-400.ttf", companion: "poppins-500.ttf" },
  exo: { main: "exo-2-800.ttf", companion: "montserrat-600.ttf" },
  josefin: { main: "josefin-sans-700.ttf", companion: "raleway-500.ttf" },
  "dm-serif": { main: "dm-serif-display-400.ttf", companion: "montserrat-600.ttf" },
};

const FONT_DIR = join(/* turbopackIgnore: true */ process.cwd(), "lib", "logos", "fonts");
const cache = new Map<string, Promise<Font>>();

function load(file: string): Promise<Font> {
  let p = cache.get(file);
  if (!p) {
    p = readFile(join(FONT_DIR, file)).then((buf) => create(buf));
    p.catch(() => cache.delete(file));
    cache.set(file, p);
  }
  return p;
}

/** The faces for a catalogue key (unknown keys get the default). */
export async function fontsFor(key: string): Promise<{ main: Font; companion: Font }> {
  const files = FILES[fontInfo(key).key] ?? FILES[DEFAULT_FONT];
  const [main, companion] = await Promise.all([load(files.main), load(files.companion)]);
  return { main, companion };
}

/** The default face — the fallback for a character a chosen font lacks. */
export const fallbackFonts = () => fontsFor(DEFAULT_FONT);

/**
 * The words in the chosen case. Spelling never changes: "title" only
 * capitalises words typed all in lower case (so "iRepair" and "ABC" stay as
 * they are). PURE.
 */
export function applyCase(text: string, letterCase: LetterCase): string {
  if (letterCase === "upper") return text.toUpperCase();
  if (letterCase === "title") return text.replace(/\S+/g, (w) => (w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w));
  return text;
}

/** Characters (other than spaces) the font has no letter for. PURE. */
export function missingChars(font: Font, text: string): string[] {
  return [...new Set([...text].filter((ch) => !/\s/.test(ch) && !font.hasGlyphForCodePoint(ch.codePointAt(0)!)))];
}

export interface SetText {
  /** SVG path data, baseline at y = 0, starting at x = 0. */
  d: string;
  /** Advance width. */
  width: number;
  /** Ink extents (y up is negative). */
  inkTop: number;
  inkBottom: number;
  inkLeft: number;
  inkRight: number;
  /** The face's capital height at this size. */
  capHeight: number;
}

/**
 * Set one run of text: kerning and ligatures from the font, `tracking` extra
 * space between letters (in ems). Returns outlines in px. PURE (given a font).
 */
export function setText(font: Font, text: string, size: number, tracking = 0, x0 = 0): SetText {
  const run = font.layout(text);
  const s = size / font.unitsPerEm;
  const parts: string[] = [];
  let x = x0;
  let inkTop = Infinity;
  let inkBottom = -Infinity;
  let inkLeft = Infinity;
  let inkRight = -Infinity;
  run.glyphs.forEach((glyph, i) => {
    const pos = run.positions[i];
    const path = glyph.path.scale(s, -s).translate(x + pos.xOffset * s, -pos.yOffset * s);
    const d = path.toSVG();
    if (d) {
      parts.push(d);
      const b = path.bbox;
      if (Number.isFinite(b.minX) && Number.isFinite(b.maxY)) {
        inkTop = Math.min(inkTop, b.minY);
        inkBottom = Math.max(inkBottom, b.maxY);
        inkLeft = Math.min(inkLeft, b.minX);
        inkRight = Math.max(inkRight, b.maxX);
      }
    }
    x += pos.xAdvance * s + (i < run.glyphs.length - 1 ? tracking * size : 0);
  });
  const capHeight = font.capHeight * s;
  return {
    d: parts.join(""),
    width: x - x0,
    inkTop: Number.isFinite(inkTop) ? inkTop : -capHeight,
    inkBottom: Number.isFinite(inkBottom) ? inkBottom : 0,
    inkLeft: Number.isFinite(inkLeft) ? inkLeft : x0,
    inkRight: Number.isFinite(inkRight) ? inkRight : x,
    capHeight,
  };
}
