/**
 * Pure helpers for the lead "colour scheme" field.
 *
 * No I/O, no React — the form, the detail page and the AI route all agree on
 * what a colour scheme *is* by importing from here. The AI check in
 * `app/api/leads/color-scheme/check` is an advisory layer on top; when it is
 * unavailable `deterministicIssues` is the entire safety net, so it has to be
 * correct on its own.
 */

/** Hard cap on how many colours a scheme may carry. */
export const MAX_COLORS = 3;

/** Wire shape of POST /api/leads/color-scheme/check. */
export interface ColorSchemeCheck {
  /** true = usable, false = definitely not, null = we could not tell (AI down). */
  ok: boolean | null;
  /** The supplied colours, normalised to hex wherever they could be resolved. */
  colors: string[];
  /** Short human reasons the scheme was rejected. */
  issues: string[];
  /** A ready-to-apply palette of up to MAX_COLORS hex colours. */
  suggestion: string[];
  /** One sentence explaining the suggestion. */
  note: string;
}

/**
 * CSS colour names we accept by name, mapped to the hex we render in a swatch.
 * Deliberately a working set (the ones sales actually say out loud), not the
 * full 148-name CSS list — an unknown name is better flagged than silently
 * accepted as something the template engine cannot resolve.
 */
export const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  crimson: "#dc143c",
  maroon: "#800000",
  pink: "#ffc0cb",
  magenta: "#ff00ff",
  purple: "#800080",
  violet: "#ee82ee",
  indigo: "#4b0082",
  lavender: "#e6e6fa",
  blue: "#0000ff",
  navy: "#000080",
  royalblue: "#4169e1",
  skyblue: "#87ceeb",
  teal: "#008080",
  turquoise: "#40e0d0",
  cyan: "#00ffff",
  aqua: "#00ffff",
  green: "#008000",
  lime: "#00ff00",
  olive: "#808000",
  forestgreen: "#228b22",
  mint: "#98ff98",
  yellow: "#ffff00",
  gold: "#ffd700",
  amber: "#ffbf00",
  orange: "#ffa500",
  coral: "#ff7f50",
  salmon: "#fa8072",
  brown: "#a52a2a",
  chocolate: "#d2691e",
  tan: "#d2b48c",
  beige: "#f5f5dc",
  cream: "#fffdd0",
  ivory: "#fffff0",
  charcoal: "#36454f",
  slate: "#708090",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  bronze: "#cd7f32",
  copper: "#b87333",
  burgundy: "#800020",
  emerald: "#50c878",
  sapphire: "#0f52ba",
  ruby: "#e0115c",
  peach: "#ffe5b4",
  plum: "#dda0dd",
  khaki: "#f0e68c",
  mustard: "#ffdb58",
  rust: "#b7410e",
  terracotta: "#e2725b",
  offwhite: "#faf9f6",
};

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB_RE = /^rgba?\(\s*[\d.%]+\s*[, ]\s*[\d.%]+\s*[, ]\s*[\d.%]+\s*(?:[,/]\s*[\d.%]+\s*)?\)$/i;

/**
 * `#abc` → `#aabbcc`. Tolerates a missing `#` (operators paste bare hex all the
 * time). Returns null when the string is not a hex colour at all.
 */
export function normalizeHex(s: string): string | null {
  const m = HEX_RE.exec(s.trim());
  if (!m) return null;
  const body = m[1].toLowerCase();
  return body.length === 3
    ? `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`
    : `#${body}`;
}

/** Lookup key for a colour name: case- and space-insensitive ("Off White" → "offwhite"). */
function nameKey(s: string): string {
  return s.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

/** True for a hex colour, an `rgb()`/`rgba()` value, or a known CSS colour name. */
export function isLikelyColor(s: string): boolean {
  const v = s.trim();
  if (!v) return false;
  if (normalizeHex(v)) return true;
  if (RGB_RE.test(v)) return true;
  return nameKey(v) in NAMED_COLORS;
}

/** The hex to paint a swatch with, or null when the entry cannot be resolved. */
export function colorToHex(s: string): string | null {
  return normalizeHex(s) ?? NAMED_COLORS[nameKey(s)] ?? null;
}

/**
 * Split a free-text scheme into entries on commas, slashes, semicolons,
 * ampersands, the word "and", and newlines. Order is preserved and duplicates
 * are dropped case-insensitively (`#FFF` and `#ffffff` are one colour).
 *
 * Separators inside brackets are left alone so `rgb(12, 34, 56)` survives.
 */
export function parseColorScheme(raw: string): string[] {
  if (!raw) return [];
  const chunks: string[] = [];
  let buf = "";
  let depth = 0;
  for (const c of raw) {
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && (c === "," || c === ";" || c === "/" || c === "&" || c === "\n" || c === "\r")) {
      chunks.push(buf);
      buf = "";
      continue;
    }
    buf += c;
  }
  chunks.push(buf);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    for (const piece of chunk.split(/\band\b/i)) {
      const v = piece.trim();
      if (!v) continue;
      const key = normalizeHex(v) ?? nameKey(v);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

/**
 * Canonical stored form: comma-joined, hex normalised, names kept as typed.
 * This is what gets written back into `color_scheme` whenever the picker moves,
 * so the picker and the text input can never describe different schemes.
 */
export function formatColorScheme(colors: string[]): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of colors) {
    const v = c.trim();
    if (!v) continue;
    const hex = normalizeHex(v);
    const key = hex ?? nameKey(v);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hex ?? v);
  }
  return out.join(", ");
}

/**
 * Everything we can fault WITHOUT the AI. This is the fallback path: when
 * Gemini times out or errors the form still refuses an empty field, still
 * refuses a fourth colour, and still refuses "up to you".
 */
export function deterministicIssues(raw: string): string[] {
  const issues: string[] = [];
  const entries = parseColorScheme(raw);
  if (entries.length === 0) {
    issues.push("A colour scheme is required.");
    return issues;
  }
  if (entries.length > MAX_COLORS) {
    issues.push(`Pick at most ${MAX_COLORS} colours — ${entries.length} were given.`);
  }
  const bad = entries.filter((e) => !isLikelyColor(e));
  if (bad.length) {
    issues.push(
      `Not recognisable as ${bad.length === 1 ? "a colour" : "colours"}: ${bad.join(", ")}.`
    );
  }
  return issues;
}
