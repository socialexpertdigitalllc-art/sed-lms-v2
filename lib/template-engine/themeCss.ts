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

// ---------------------------------------------------------------------------
// Template-aware theming (the fix for "colors do nothing on a new template")
//
// buildThemeOverrideCss above hardcodes --brand/--brand-deep/--accent, which are
// THIS ONE template's variable names. Upload a template that calls them
// --primary/--color-main, or that hardcodes hex values, and the override lands
// on nothing at all: the site ships in the template's demo palette and the
// operator sees their color choices silently ignored.
//
// planThemeApplication() derives the target from the template's OWN stylesheet:
//   1. variable path  — bind the client's colors onto the custom properties the
//                       stylesheet actually declares AND references;
//   2. hex-remap path — when there are no usable color custom properties,
//                       rewrite the template's most-used non-neutral hex values;
//   3. nothing        — a stylesheet with only neutrals, or a theme with no
//                       valid color, is left exactly as it is.
// The legacy --brand/--brand-deep/--accent override is always emitted too, so
// the original template keeps working byte-for-byte as before.
//
// Only validated hex colors are ever emitted (isHexColor), so nothing a lead
// typed can become raw CSS. Pure: no I/O.
// ---------------------------------------------------------------------------

/** The theme fields in priority order: primary, supporting, accent. */
const THEME_SLOTS: (keyof ThemeColors)[] = ["brand", "brand_deep", "accent"];

/** Selectors whose declarations define document-level custom properties. */
const ROOT_SELECTOR = /^(?::root|:host|html|body)\b/;

const HEX_TOKEN = /#[0-9a-fA-F]{3,8}\b/g;
const COLOR_VALUE = /^(?:#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?)\()/;

/** `#abc` -> `#aabbcc`; anything that is not a 3/6-digit hex -> null. */
function normalizeHex(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  return null; // 4/8-digit (alpha) hex is deliberately left alone
}

/**
 * True for white, black, and every grey/near-grey — the colors a template uses
 * for text, borders, and page background. Remapping those to a brand color
 * would repaint the whole page, so they are never candidates.
 */
export function isNeutralHex(raw: string): boolean {
  const hex = normalizeHex(raw);
  if (!hex) return true; // unparseable -> treat as "don't touch"
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if ((max - min) / 255 < 0.12) return true; // grey axis (incl. #fff / #000)
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.94 || lum < 0.06; // near-white / near-black tints
}

interface VarCandidate {
  name: string;
  value: string;
  refs: number;
  order: number;
}

/**
 * Colour custom properties declared in a `:root`/`:host`/`html`/`body` block,
 * ranked most-referenced-first — `var(--x)` reference count is the best
 * available proxy for "this is the template's primary brand colour". Neutral
 * values are excluded: a stylesheet's most-referenced variable is usually
 * --text or --bg, and painting those brand-coloured would wreck the page.
 * Exported for tests.
 */
export function findThemeVariables(css: string): VarCandidate[] {
  const found = new Map<string, VarCandidate>();
  let order = 0;
  // Declaration blocks never nest, so a non-brace body is a safe block match.
  const blocks = /([^{}]+)\{([^{}]*)\}/g;
  let block: RegExpExecArray | null;
  while ((block = blocks.exec(css)) !== null) {
    const selectors = block[1].split(",").map((s) => s.trim()).filter(Boolean);
    if (!selectors.some((s) => ROOT_SELECTOR.test(s))) continue;
    const decls = /(--[\w-]+)\s*:\s*([^;}]+)/g;
    let decl: RegExpExecArray | null;
    while ((decl = decls.exec(block[2])) !== null) {
      const name = decl[1];
      const value = decl[2].trim();
      if (!COLOR_VALUE.test(value)) continue;
      if (value.startsWith("#") && isNeutralHex(value)) continue;
      if (found.has(name)) continue;
      found.set(name, { name, value, refs: 0, order: order++ });
    }
  }
  for (const c of found.values()) {
    const refs = css.match(new RegExp(`var\\(\\s*${c.name.replace(/-/g, "\\-")}\\b`, "g"));
    c.refs = refs ? refs.length : 0;
  }
  return [...found.values()]
    .filter((c) => c.refs > 0) // declared but never used = not the palette
    .sort((a, b) => b.refs - a.refs || a.order - b.order);
}

/**
 * The template's most-used non-neutral hex colors, most frequent first.
 * Exported for tests.
 */
export function findDominantHexColors(css: string): { hex: string; count: number }[] {
  const counts = new Map<string, { hex: string; count: number; order: number }>();
  let order = 0;
  for (const tok of css.match(HEX_TOKEN) ?? []) {
    const hex = normalizeHex(tok);
    if (!hex || isNeutralHex(hex)) continue;
    const prev = counts.get(hex);
    if (prev) prev.count++;
    else counts.set(hex, { hex, count: 1, order: order++ });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .map(({ hex, count }) => ({ hex, count }));
}

export interface ThemePlan {
  /** How the client's colors reach the page. */
  strategy: "vars" | "hex" | "none";
  /** CSS to append to the stylesheet (always includes the legacy override). */
  overrideCss: string;
  /** normalized template hex -> client hex, applied throughout the stylesheet. */
  replacements: Record<string, string>;
  /** Template custom properties bound to the client's colors (strategy "vars"). */
  boundVars: string[];
}

/**
 * Work out how to apply `theme` to THIS stylesheet. Pure and total: safe to
 * call on any string, returns an inert plan when there is nothing to do.
 */
export function planThemeApplication(css: string, theme: ThemeColors | undefined): ThemePlan {
  const legacy = buildThemeOverrideCss(theme);
  const inert: ThemePlan = { strategy: "none", overrideCss: legacy, replacements: {}, boundVars: [] };
  if (!theme || typeof css !== "string" || css.length === 0) return inert;

  // Only the slots the lead actually gave us a valid color for.
  const slots = THEME_SLOTS.filter((k) => isHexColor(theme[k])).map((k) => ({
    key: k,
    color: (theme[k] as string).trim(),
  }));
  if (slots.length === 0) return inert;

  // 1. variable path — bind onto the names the template really uses.
  const vars = findThemeVariables(css);
  if (vars.length > 0) {
    const bound: string[] = [];
    const decls: string[] = [];
    for (let i = 0; i < slots.length && i < vars.length; i++) {
      // Never re-declare a legacy var here; buildThemeOverrideCss owns those.
      if (VAR_MAP.some(([, v]) => v === vars[i].name)) continue;
      bound.push(vars[i].name);
      decls.push(`  ${vars[i].name}: ${slots[i].color};`);
    }
    if (decls.length > 0) {
      return {
        strategy: "vars",
        overrideCss:
          legacy +
          `\n/* client brand colors — bound onto this template's own custom properties */\n:root{\n${decls.join("\n")}\n}\n`,
        replacements: {},
        boundVars: bound,
      };
    }
    // Every candidate was a legacy var: the original template. Legacy override
    // already covers it.
    return { ...inert, strategy: "vars", boundVars: vars.map((v) => v.name) };
  }

  // 2. hex-remap fallback — no usable custom properties, so rewrite the
  //    template's own dominant colors in place. Everything else is untouched.
  const dominant = findDominantHexColors(css);
  if (dominant.length === 0) return inert; // neutrals only: leave the palette alone
  const replacements: Record<string, string> = {};
  for (let i = 0; i < slots.length && i < dominant.length; i++) {
    replacements[dominant[i].hex] = slots[i].color;
  }
  return { strategy: "hex", overrideCss: legacy, replacements, boundVars: [] };
}

/**
 * Apply the plan: rewrite the mapped hex values everywhere in the stylesheet
 * (byte-for-byte elsewhere), then append the override block. This is the one
 * function the runner calls per stylesheet.
 */
export function applyThemeToCss(css: string, theme: ThemeColors | undefined): string {
  if (typeof css !== "string") return css;
  const plan = planThemeApplication(css, theme);
  let out = css;
  if (Object.keys(plan.replacements).length > 0) {
    out = out.replace(HEX_TOKEN, (tok) => {
      const hex = normalizeHex(tok);
      return (hex && plan.replacements[hex]) || tok;
    });
  }
  return out + plan.overrideCss;
}
