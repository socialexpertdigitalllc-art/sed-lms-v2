import { parseJsonLoose } from "@/lib/ai/json";
import { stripReasoningBlocks } from "@/lib/site-builder/generate";
import { nameKey } from "./brief";

/**
 * What a vision model (task `logo_check`) checks on a design. PURE.
 *  - A typeset design (MiniMax draws the symbol, our code sets the name): the
 *    name can't be misspelled, but the symbol may have stray letters in it —
 *    a symbol with writing is drawn again.
 *  - A complete design (Google draws it all, name included): the lettering is
 *    read back and compared with the name — see "spelling" below.
 */

/** Does the lettering on a design say the name — and only that? */
export type SpellingVerdict = "exact" | "extra" | "misspelled" | "unchecked";

export const ICON_CHECK_SYSTEM = `You inspect logo symbols for a design studio. You are strict about text: any letter, number, word, initial or mark that looks like writing counts, even if it is tiny or decorative. Reply with JSON only.`;

export function iconCheckPrompt(): string {
  return [
    `Look at this logo symbol.`,
    `1. Is there ANY text in it — letters, numbers, words, initials, or scribbles that look like writing?`,
    `2. Is it one clean, simple symbol on a plain background (not a scene, not several objects, not cluttered)?`,
    `Reply with JSON only: {"text": true | false, "clean": true | false, "issues": ["short note", ...], "quality": 1-10}`,
    `"quality": how professional and usable it is as a small-business logo symbol.`,
  ].join("\n");
}

export interface IconReading {
  text: boolean | null;
  clean: boolean | null;
  issues: string[];
  quality: number | null;
}

export function parseIconReading(raw: string): IconReading | null {
  const j = parseJsonLoose<Record<string, unknown>>(stripReasoningBlocks(raw));
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const q = Number(j.quality);
  return {
    text: typeof j.text === "boolean" ? j.text : null,
    clean: typeof j.clean === "boolean" ? j.clean : null,
    issues: Array.isArray(j.issues) ? j.issues.filter((t): t is string => typeof t === "string").map((t) => t.trim().slice(0, 120)).filter(Boolean).slice(0, 4) : [],
    quality: Number.isFinite(q) ? Math.max(1, Math.min(10, Math.round(q))) : null,
  };
}

/** A design's place in the line-up: a clean, good symbol first; a symbol with writing in it last. PURE. */
export function designScore(d: { hasIcon: boolean; check: IconReading | null }): number {
  const q = d.check?.quality ?? 6;
  let score = 100 + q * 3 + (d.hasIcon ? 4 : 0);
  if (d.check?.text) score -= 60;
  if (d.check?.clean === false) score -= 15;
  return score;
}

/* ---------------------------------------------------------- spelling ---- */
/*
 * A complete logo drawn by Google (name included) is read back letter by
 * letter by a vision model, and the reading is compared with the name IN CODE
 * (the model only transcribes). A wrong one is sent back to Google to fix the
 * lettering; one still wrong after that is flagged and sorted last.
 */

export const SPELL_CHECK_SYSTEM = `You proofread logo images. You transcribe text EXACTLY as drawn — letter by letter, including any misspelling, missing or extra letters. You never correct, complete or guess spelling. Reply with JSON only.`;

export function spellCheckPrompt(): string {
  return [
    `Look at this logo image.`,
    `1. Transcribe EVERY piece of text in it exactly as drawn, letter by letter, in reading order (each line or separate word group as its own entry). Copy mistakes exactly; do not fix them. Ignore shapes that are only decorative.`,
    `2. Judge the design.`,
    `Reply with JSON only: {"text": ["..."], "legible": true | false, "issues": ["short note", ...], "quality": 1-10}`,
    `"issues": only real problems (garbled or malformed letters, text cut off, extra words, cluttered). "quality": how professional and polished it is as a business logo.`,
  ].join("\n");
}

export interface LogoReading {
  text: string[];
  legible: boolean | null;
  issues: string[];
  quality: number | null;
}

export function parseReading(raw: string): LogoReading | null {
  const j = parseJsonLoose<Record<string, unknown>>(stripReasoningBlocks(raw));
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const text = Array.isArray(j.text) ? j.text.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean).slice(0, 12) : typeof j.text === "string" ? [j.text.trim()] : [];
  const q = Number(j.quality);
  return {
    text,
    legible: typeof j.legible === "boolean" ? j.legible : null,
    issues: Array.isArray(j.issues) ? j.issues.filter((t): t is string => typeof t === "string").map((t) => t.trim().slice(0, 120)).filter(Boolean).slice(0, 4) : [],
    quality: Number.isFinite(q) ? Math.max(1, Math.min(10, Math.round(q))) : null,
  };
}

export interface Spelling {
  verdict: SpellingVerdict;
  /** What the logo actually says (as read). */
  read: string;
  /** Words on it that aren't the name. */
  extra: string[];
}

/**
 * Does the reading say the name — and only that? Case, spacing and
 * punctuation don't matter; "&" = "and"; the name split across lines is still
 * the name. PURE; tested.
 */
export function judgeSpelling(reading: LogoReading | null, logoText: string): Spelling {
  if (!reading) return { verdict: "unchecked", read: "", extra: [] };
  const read = reading.text.join(" · ");
  const want = nameKey(logoText);
  const got = nameKey(reading.text.join(" "));
  if (!got) return { verdict: "misspelled", read, extra: [] };
  if (got === want) return { verdict: "exact", read, extra: [] };
  if (got.includes(want)) {
    const extra = reading.text.filter((t) => {
      const k = nameKey(t);
      return k && !want.includes(k);
    });
    return { verdict: "extra", read, extra: extra.length ? extra : [read] };
  }
  return { verdict: "misspelled", read, extra: [] };
}

/** A complete design's place in the line-up: right spelling first, then wide and good. PURE. */
export function artScore(d: { spelling: SpellingVerdict; quality: number | null; horizontal: boolean }): number {
  const spell = { exact: 100, unchecked: 55, extra: 35, misspelled: 0 }[d.spelling];
  return spell + (d.horizontal ? 15 : 0) + (d.quality ?? 6) * 3;
}
