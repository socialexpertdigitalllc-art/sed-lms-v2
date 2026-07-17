// Template Engine v2 — apply the client's brand colors WITHOUT regenerating the
// template CSS. v2's whole guarantee is "design preserved by construction" —
// style.css is never sent to the model — so colors are applied the only safe
// way: a deterministic `:root` override appended to style.css that remaps the
// template's color custom properties (--brand, --brand-deep, --accent) to the
// client's colors. Layout, spacing, and everything else stay byte-for-byte.
//
// Only well-formed hex colors are ever emitted, so nothing the planner or a
// lead typed can inject arbitrary CSS. Pure: no I/O.

export interface ThemeColors {
  brand?: string;
  brand_deep?: string;
  accent?: string;
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** True only for a plain #rgb / #rrggbb hex color. */
export function isHexColor(v: unknown): boolean {
  return typeof v === "string" && HEX.test(v.trim());
}

// The template's color custom properties → the content-model theme field.
const VAR_MAP: [keyof ThemeColors, string][] = [
  ["brand", "--brand"],
  ["brand_deep", "--brand-deep"],
  ["accent", "--accent"],
];

/**
 * Build the `:root` override to append to style.css, containing only the vars
 * whose value is a valid hex color. Returns "" when none are valid, so a lead
 * with no usable color ("up to us", "match the logo", empty) keeps the
 * template's own palette untouched.
 */
export function buildThemeOverrideCss(theme: ThemeColors | undefined): string {
  if (!theme) return "";
  const decls = VAR_MAP
    .filter(([key]) => isHexColor(theme[key]))
    .map(([key, cssVar]) => `  ${cssVar}: ${(theme[key] as string).trim()};`);
  if (decls.length === 0) return "";
  return `\n/* client brand colors — applied over the template palette, layout untouched */\n:root{\n${decls.join("\n")}\n}\n`;
}
