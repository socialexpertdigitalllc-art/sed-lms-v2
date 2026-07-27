import { Diagnostic, FileMap, ThemeDef } from "../schema";

const ROLE_ORDER = ["brand", "brand_deep", "accent"] as const;

export function isNeutralHex(hex: string): boolean {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const lum = (max + min) / 2;
  const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * lum - 1));
  return sat < 0.12 || lum > 0.94 || lum < 0.06;
}

const cssAssets = (files: FileMap): [string, string][] =>
  Object.entries(files)
    .filter(([p]) => p.toLowerCase().endsWith(".css"))
    .map(([p, b]) => [p, new TextDecoder().decode(b)]);

const HEX = "#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})";

// ---------------------------------------------------------------------------
// `theme_literal_colors` diagnostic (Phase 4c): css_vars mode only ever
// retints what actually reads a CSS variable. A template that ALSO writes a
// mapped role's own hex as a literal — outside the `:root` block that
// legitimately declares it as a custom property — has spots that will never
// see the client's color, and today nothing tells the operator that at
// review time (the failure this warn exists for shipped with zero signal).
// Mirrors render/theme.ts's own hex-matching rules (case-insensitive, 3-digit
// shorthand, boundary-safe) so "the same color" means the same thing at
// compile time and render time — duplicated rather than imported, since
// compiler/ and render/ are separate layers and this is ~15 lines of pure
// text matching, not worth a shared module for.
// ---------------------------------------------------------------------------

function normalizeHex6(hex: string): string {
  const h = hex.replace(/^#/, "").toLowerCase();
  return h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
}

function shorthandOf(hex6: string): string | null {
  if (hex6[0] === hex6[1] && hex6[2] === hex6[3] && hex6[4] === hex6[5]) {
    return hex6[0] + hex6[2] + hex6[4];
  }
  return null;
}

/** Strips every `:root { ... }` block from a CSS corpus — same simplifying
 *  assumption as the comment/url() stripping in `extractTheme` below (a
 *  `:root` rule's declarations never themselves contain a nested `{`), so
 *  the diagnostic only counts a role's hex OUTSIDE the block that
 *  legitimately declares it as a custom property. */
function stripRootBlocks(css: string): string {
  return css.replace(/:root\s*\{[^}]*\}/g, "");
}

/** How many times `hex` (case-insensitive, its 3-digit shorthand counted
 *  too) appears literally in `css` — boundary-safe the same way
 *  render/theme.ts's `replaceHexLiteral` is, so `#0c5aa0` never counts a
 *  match inside `#0c5aa0ff` or `#0c5aa0-box`. */
function countHexLiteral(css: string, hex: string): number {
  const hex6 = normalizeHex6(hex);
  const short = shorthandOf(hex6);
  const alt = short ? `${hex6}|${short}` : hex6;
  const re = new RegExp(`#(?:${alt})(?![0-9a-fA-F_-])`, "gi");
  return (css.match(re) ?? []).length;
}

/** More than this many literal escapes of a mapped role's own hex, outside
 *  `:root`, is the signal worth surfacing — "more than a handful" per spec;
 *  a one-off inline override isn't worth a warning, a template that
 *  hardcodes its brand color throughout is. */
const LITERAL_ESCAPE_THRESHOLD = 3;

/** Pass 5: map the template's colors to named roles. */
export function extractTheme(files: FileMap): { theme: ThemeDef; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const css = cssAssets(files)
    .map(([, s]) => s)
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/url\([^)]*\)/g, "url()");

  // Path 1: custom properties ranked by var() usage, deduped by name
  // (first non-neutral hex seen wins — later redeclarations, e.g. a
  // dark-mode @media override, must not mint a second ranked entry)
  const declMap = new Map<string, string>();
  for (const [, name, hex] of css.matchAll(new RegExp(`(--[A-Za-z0-9_-]+)\\s*:\\s*(${HEX})\\b`, "g"))) {
    const norm = hex.toLowerCase();
    if (isNeutralHex(norm)) continue;
    if (!declMap.has(name)) declMap.set(name, norm);
  }
  if (declMap.size > 0) {
    const ranked = [...declMap.entries()]
      .map(([name, hex]) => ({
        name,
        hex,
        uses: (css.match(new RegExp(`var\\(\\s*${name}\\s*[,)]`, "g")) ?? []).length,
      }))
      .sort((a, b) => b.uses - a.uses);
    const roles: ThemeDef["roles"] = {};
    ROLE_ORDER.forEach((role, i) => { if (ranked[i]) roles[role] = { var: ranked[i].name, hex: ranked[i].hex }; });

    // theme_literal_colors (Phase 4c): a REVIEW-TIME signal about the
    // template itself — a property of the file the operator is about to
    // accept, not of any one run's rendered output — which is why this is
    // checked here rather than at render time.
    const outsideRoot = stripRootBlocks(css);
    for (const [role, def] of Object.entries(roles)) {
      const count = countHexLiteral(outsideRoot, def.hex);
      if (count > LITERAL_ESCAPE_THRESHOLD) {
        diagnostics.push({
          level: "warn",
          code: "theme_literal_colors",
          message: `"${role}" (${def.hex}) also appears as a literal color ${count} times outside :root — theme control will stay partial there until those spots use var(${def.var}) instead of the literal hex.`,
        });
      }
    }

    return { theme: { mode: "css_vars", roles }, diagnostics };
  }

  // Path 2: literal hex frequency
  const counts = new Map<string, number>();
  for (const [, hex] of css.matchAll(new RegExp(`(${HEX})\\b`, "g"))) {
    const norm = hex.toLowerCase();
    if (!isNeutralHex(norm)) counts.set(norm, (counts.get(norm) ?? 0) + 1);
  }
  if (counts.size > 0) {
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
    const roles: ThemeDef["roles"] = {};
    ROLE_ORDER.forEach((role, i) => { if (ranked[i]) roles[role] = { hex: ranked[i] }; });
    return { theme: { mode: "literal_remap", roles }, diagnostics };
  }

  diagnostics.push({ level: "info", code: "theme_none", message: "No non-neutral colors found; recoloring disabled for this template" });
  return { theme: { mode: "none", roles: {} }, diagnostics };
}
