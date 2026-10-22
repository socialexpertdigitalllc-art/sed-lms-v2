import { parseJsonLoose } from "@/lib/ai/json";
import { stripReasoningBlocks } from "@/lib/site-builder/generate";
import { nameKey } from "./brief";

/**
 * Image models misspell. Every design is read back by a vision model (task
 * `logo_check`) and the reading is compared, in code, with the logo text —
 * so a design with "CONSTRUCTOIN" on it is flagged and sorted last, and a
 * round where nothing is spelled right draws more. The comparison is
 * deterministic; the model only transcribes. PURE except `readLogo`'s caller.
 */

export const CHECK_SYSTEM = `You proofread logo images. You transcribe text EXACTLY as drawn — letter by letter, including any misspelling, missing or extra letters. You never correct, complete or guess spelling. Reply with JSON only.`;

export function checkPrompt(): string {
  return [
    `Look at this logo image.`,
    `1. Transcribe EVERY piece of text in it exactly as drawn, letter by letter, in reading order (each line or separate word group as its own entry). Copy mistakes exactly; do not fix them. Ignore letters that are only decorative shapes.`,
    `2. Judge the design.`,
    `Reply with JSON only: {"text": ["..."], "layout": "horizontal" | "stacked" | "other", "legible": true | false, "issues": ["short note", ...], "quality": 1-10}`,
    `"issues": only real problems (garbled or malformed letters, text cut off, extra words, cluttered, looks like clip-art). "quality": how professional and usable it is as a small-business logo.`,
  ].join("\n");
}

export interface LogoReading {
  text: string[];
  layout: "horizontal" | "stacked" | "other" | null;
  legible: boolean | null;
  issues: string[];
  quality: number | null;
}

export function parseReading(raw: string): LogoReading | null {
  const j = parseJsonLoose<Record<string, unknown>>(stripReasoningBlocks(raw));
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const text = Array.isArray(j.text) ? j.text.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean).slice(0, 12) : typeof j.text === "string" ? [j.text.trim()] : [];
  const layout = j.layout === "horizontal" || j.layout === "stacked" || j.layout === "other" ? j.layout : null;
  const q = Number(j.quality);
  return {
    text,
    layout,
    legible: typeof j.legible === "boolean" ? j.legible : null,
    issues: Array.isArray(j.issues) ? j.issues.filter((t): t is string => typeof t === "string").map((t) => t.trim().slice(0, 120)).filter(Boolean).slice(0, 4) : [],
    quality: Number.isFinite(q) ? Math.max(1, Math.min(10, Math.round(q))) : null,
  };
}

/** Edit distance (Levenshtein). PURE. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

export type SpellingVerdict = "exact" | "extra" | "misspelled" | "unchecked";

export interface Spelling {
  verdict: SpellingVerdict;
  /** What the logo actually says (as read). */
  read: string;
  /** The words on it that aren't the name (extra). */
  extra: string[];
}

/**
 * Does the reading say the logo text — and only that? Case, spacing and
 * punctuation don't matter ("ABC ROOFING" = "Abc Roofing"); "&" = "and"; the
 * name split across lines is still the name. PURE; tested.
 */
export function judgeSpelling(reading: LogoReading | null, logoText: string): Spelling {
  if (!reading) return { verdict: "unchecked", read: "", extra: [] };
  const read = reading.text.join(" · ");
  const want = nameKey(logoText);
  const got = nameKey(reading.text.join(" "));
  if (!got) return { verdict: "misspelled", read, extra: [] };
  if (got === want) return { verdict: "exact", read, extra: [] };
  if (got.includes(want)) {
    // The name is all there — what else is written?
    const extra = reading.text.filter((t) => {
      const k = nameKey(t);
      return k && !want.includes(k);
    });
    return { verdict: "extra", read, extra: extra.length ? extra : [read] };
  }
  return { verdict: "misspelled", read, extra: [] };
}

export interface RankInput {
  spelling: SpellingVerdict;
  quality: number | null;
  horizontal: boolean;
  background: "removed" | "busy" | "dark";
  /** Brand colours present ÷ brand ink colours (1 when the lead has none). */
  colorShare: number;
  offPalette: number;
}

/** A design's place in the line-up: right spelling first, then horizontal, on-brand and good. PURE. */
export function rankScore(r: RankInput): number {
  const spell = { exact: 100, unchecked: 55, extra: 35, misspelled: 0 }[r.spelling];
  const shape = r.horizontal ? 20 : 0;
  const bg = r.background === "removed" ? 12 : 0;
  const colour = Math.round(15 * r.colorShare) - Math.round(10 * r.offPalette);
  const quality = (r.quality ?? 6) * 3;
  return spell + shape + bg + colour + quality;
}
