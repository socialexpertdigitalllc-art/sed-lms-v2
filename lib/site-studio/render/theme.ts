import { FileMap, ThemeDef } from "../schema";

// ---------------------------------------------------------------------------
// Literal hex matching — shared by every literal-remap call site below
// (CSS/JS assets AND, via `applyThemeToHtml`, a rendered page's own HTML) so
// they can never drift into two different notions of "the same color".
// ---------------------------------------------------------------------------

/** Lowercases a hex color and expands a 3-digit shorthand to 6 digits, with
 *  the leading `#` stripped — the CANONICAL form every match below is done
 *  against, so "#FFF", "#fff", and "#ffffff" are all recognized as the same
 *  color regardless of which form a role's own declared hex happens to use. */
function normalizeHex6(hex: string): string {
  const h = hex.replace(/^#/, "").toLowerCase();
  return h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
}

/** The 3-digit shorthand for a normalized 6-digit hex, or null when the color
 *  can't be losslessly compressed (each channel's two digits must match one
 *  another — "#0c5aa0" has no shorthand; "#ffffff" -> "fff" does). Only a
 *  color that DOES have one is also matched in shorthand form below — this
 *  is what makes `#fff` recognized as the same color as a role declared
 *  `#ffffff`, without ever inventing a shorthand for a color that has none. */
function shorthandOf(hex6: string): string | null {
  if (hex6[0] === hex6[1] && hex6[2] === hex6[3] && hex6[4] === hex6[5]) {
    return hex6[0] + hex6[2] + hex6[4];
  }
  return null;
}

/**
 * Replaces every literal occurrence of `fromHex` (case-insensitive, matching
 * its 3-digit shorthand too when one exists — see `shorthandOf`) with
 * `toHex`, in plain text. Deliberately text-only, not CSS- or HTML-aware: a
 * hex color reads identically whether it sits in a stylesheet rule, an
 * inline `style="..."` attribute, or a tokenized JS asset, so one function
 * covers all three call sites (`applyTheme`'s asset pass and
 * `applyThemeToHtml`'s page-HTML pass, both below).
 *
 * BOUNDARY SAFETY: this must never fire on a PARTIAL match inside a longer
 * token — a naive `text.split(hex).join(...)` would happily corrupt
 * `#0c5aa0ff` (an 8-digit hex-with-alpha) or `#0c5aa0-box` (an id that merely
 * starts with the same 6 digits). The regex below is anchored with a
 * negative lookahead that rejects a match immediately followed by another
 * hex digit, `-`, or `_`: `#0c5aa0ff` fails because `f` is a hex digit, and
 * `#0c5aa0-box` fails because `-` is excluded explicitly — it is NOT a hex
 * digit, so a lookahead that only excluded hex digits would have let this
 * one through untouched, silently splicing a doc's hex into the middle of
 * someone else's identifier.
 */
function replaceHexLiteral(text: string, fromHex: string, toHex: string): string {
  const hex6 = normalizeHex6(fromHex);
  const toHex6 = normalizeHex6(toHex);
  // Semantically the SAME color (case/3-vs-6-digit differences aside): the
  // round-trip property (this file's own doc comment, and
  // tests/siteStudioRenderTheme.test.ts) depends on this being a TRUE no-op
  // rather than a normalize-then-replace — a naive `text.replace(re, toHex)`
  // would still rewrite an original uppercase `#0C5AA0` to whatever case
  // `toHex` happens to be declared in, changing bytes the samples-based
  // verification render must reproduce exactly.
  if (toHex6 === hex6) return text;
  const short = shorthandOf(hex6);
  const alt = short ? `${hex6}|${short}` : hex6;
  const re = new RegExp(`#(?:${alt})(?![0-9a-fA-F_-])`, "gi");
  return text.replace(re, toHex);
}

/** Applies `replaceHexLiteral` for every mapped role's own demo hex -> the
 *  document's hex for that role, in order. A role with no declared hex on
 *  the template (shouldn't happen — `entries` is already filtered to mapped
 *  roles by every caller — but checked defensively rather than assumed) is
 *  skipped rather than throwing. Exported so tests can probe the matching
 *  rule directly without going through a full `applyTheme`/`renderSite`
 *  call. */
export function remapLiteralColorsInText(
  text: string,
  theme: ThemeDef,
  entries: [string, string][],
): string {
  let out = text;
  for (const [role, hex] of entries) {
    const roleHex = theme.roles[role]?.hex;
    if (!roleHex) continue;
    out = replaceHexLiteral(out, roleHex, hex);
  }
  return out;
}

/** Text-asset extensions the literal remap ever looks at inside `assets` —
 *  the same scope compiler/assetIdentity.ts's own TEXT_ASSET_RE treats as
 *  safe plain text (a binary asset's bytes must never be string-mangled). */
const TEXT_ASSET_RE = /\.(m?js|cjs|css)$/i;

function remapLiteralColorsInAssets(
  assets: FileMap,
  theme: ThemeDef,
  entries: [string, string][],
  include: (path: string) => boolean,
): FileMap {
  const out: FileMap = { ...assets };
  for (const [path, bytes] of Object.entries(assets)) {
    if (!include(path)) continue;
    const text = new TextDecoder().decode(bytes);
    out[path] = new TextEncoder().encode(remapLiteralColorsInText(text, theme, entries));
  }
  return out;
}

/**
 * Apply the operator/lead theme to the template's assets.
 *
 * css_vars → emits `studio-theme.css` overriding the mapped variables
 *   (caller injects the `<link>`) AND ALSO literally retints every mapped
 *   role's own demo hex wherever it appears verbatim in a text asset
 *   (.css/.js/.mjs/.cjs) — this is the Phase 4c fix: a real template writes
 *   most of its color as literals (`color:#0C5AA0` in an inline `style` or a
 *   rule that never touches a variable), so the `:root` override alone left
 *   the site looking untouched. See `applyThemeToHtml` below for the sibling
 *   pass over each rendered PAGE's HTML, which isn't reachable from here —
 *   a page's assembled HTML is not one of `assets`' entries.
 * literal_remap → rewrites the original hexes inside CSS assets only —
 *   unchanged scope, this mode's own established behavior; only the
 *   underlying match/replace picked up the case-insensitive + 3-digit-
 *   shorthand + boundary-safe upgrade shared with css_vars mode above (see
 *   `replaceHexLiteral`).
 * none / empty docTheme → untouched.
 */
export function applyTheme(
  assets: FileMap, theme: ThemeDef, docTheme: Record<string, string>,
): { assets: FileMap; injectCssFile?: string } {
  const entries = Object.entries(docTheme).filter(([role]) => theme.roles[role]);
  if (theme.mode === "none" || entries.length === 0) return { assets };

  if (theme.mode === "css_vars") {
    const lines = entries.map(([role, hex]) => `  ${theme.roles[role].var}: ${hex};`);
    const remapped = remapLiteralColorsInAssets(assets, theme, entries, (p) => TEXT_ASSET_RE.test(p));
    return {
      assets: { ...remapped, "studio-theme.css": new TextEncoder().encode(`:root {\n${lines.join("\n")}\n}\n`) },
      injectCssFile: "studio-theme.css",
    };
  }

  // literal_remap
  const remapped = remapLiteralColorsInAssets(assets, theme, entries, (p) => p.toLowerCase().endsWith(".css"));
  return { assets: remapped };
}

/**
 * The renderer-facing sibling of `applyTheme`'s literal remap: retints a
 * fully-assembled PAGE's HTML — inline `style="color:#0C5AA0"` attributes, a
 * literal color inside an embedded `<style>` block, anywhere else a mapped
 * role's demo hex shows up verbatim. `applyTheme` above cannot do this
 * itself: a rendered page's HTML doesn't exist as one of `tpl.assets`'
 * entries — it is built fresh, per doc page, inside renderer.ts's own
 * per-page loop — so `renderSite` calls this directly on each page's
 * assembled `html` string once slot/identity/nav substitution is done.
 *
 * Only css_vars mode retints HTML — matching the scope of the Phase 4c fix
 * (literal_remap mode's own established behavior, CSS-assets-only, is left
 * exactly as it was; see `applyTheme`'s own doc comment). `none`, or an
 * empty/unmapped docTheme, is a no-op either way.
 */
export function applyThemeToHtml(
  html: string, theme: ThemeDef, docTheme: Record<string, string>,
): string {
  if (theme.mode !== "css_vars") return html;
  const entries = Object.entries(docTheme).filter(([role]) => theme.roles[role]);
  if (entries.length === 0) return html;
  return remapLiteralColorsInText(html, theme, entries);
}
