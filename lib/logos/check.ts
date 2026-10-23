import { parseJsonLoose } from "@/lib/ai/json";
import { stripReasoningBlocks } from "@/lib/site-builder/generate";

/**
 * The symbol check. The name is typeset by our code, so its spelling can't go
 * wrong; what CAN go wrong is the image model sneaking letters or
 * letter-like scribbles into the symbol. A vision model (task `logo_check`)
 * looks at each symbol; one with writing in it is drawn again. PURE.
 */

/** How the old rounds (before 2026-10-23: the image model drew the name) were marked. */
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
