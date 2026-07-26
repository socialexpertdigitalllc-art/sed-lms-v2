import { FileMap } from "../schema";
import { idToken } from "../tokens";
import { Inventory } from "./inventory";

/**
 * Text-asset extensions this pass is scoped to. Deliberately narrow — JS and
 * CSS are the two concrete file types the leak this pass closes was found
 * in (a template's runtime-built header/nav echoing the demo business name
 * and phone straight into a client's deployed site), and they're the only
 * two contexts with a rigorously-defined, hostile-value-tested escape
 * function (`escapeJsString`/`escapeCssString` in ../tokens.ts). Other text
 * formats (json/svg/xml/txt/…) are consciously left out of scope for this
 * phase rather than given an under-designed escape rule — see the Phase 4b
 * asset-identity report for the reasoning.
 */
const TEXT_ASSET_RE = /\.(m?js|cjs|css)$/i;

export function isTextAsset(path: string): boolean {
  return TEXT_ASSET_RE.test(path);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Same priority identity.ts's HTML pass relies on: replace the longer,
// more-specific string (an href built FROM a value) before the bare value
// itself, or the bare-value pass would already have eaten the substring the
// href-shaped pass needed to match whole. Any identity key not listed here
// (future additions) is processed last, in insertion order.
const KEY_ORDER = ["map_embed", "phone_href", "email_href", "phone", "email", "business_name", "year"];

// business_name/year get the same word-boundary guard identity.ts's HTML
// pass applies to them — an unbounded match risks corrupting a substring of
// an unrelated longer token (a version string, a different word that
// happens to contain the business name as a substring).
const WORD_BOUNDED = new Set(["business_name", "year"]);

function orderedKeys(identity: Record<string, string>): string[] {
  const known = KEY_ORDER.filter((k) => k in identity);
  const rest = Object.keys(identity).filter((k) => !KEY_ORDER.includes(k));
  return [...known, ...rest];
}

/**
 * Pass 2b: tokenize identity occurrences inside TEXT assets (.js/.css),
 * reusing the SAME values `compiler/identity.ts`'s HTML pass already
 * extracted — assets and skeletons must agree on one canonical value per
 * key, never re-detect independently. Binary assets (images, fonts, etc.)
 * are left completely untouched.
 *
 * This is blind text substitution, exactly like identity.ts's
 * `replaceEverywhere`: it does not parse the JS/CSS, it just finds and
 * replaces the literal value string, leaving whatever quoting/markup
 * surrounded it intact. The token left behind (`{{id:business_name}}`) is
 * plain ASCII text, safe to sit inside a JS or CSS string unescaped — it is
 * the render-time substitution (render/renderer.ts) that must re-insert the
 * real value through a context-aware escape, since THAT value is
 * operator/lead-supplied and may contain quotes/backslashes the token
 * itself never did.
 */
export function tokenizeAssetIdentity(
  inv: Inventory,
  identity: Record<string, string>,
): { assets: FileMap; tokenizedAssets: string[] } {
  const assets: FileMap = { ...inv.assets };
  const tokenizedAssets: string[] = [];
  const keys = orderedKeys(identity);

  for (const [path, bytes] of Object.entries(inv.assets)) {
    if (!isTextAsset(path)) continue;
    let text = new TextDecoder().decode(bytes);
    let changed = false;

    for (const key of keys) {
      const value = identity[key];
      if (!value) continue;
      const bounded = WORD_BOUNDED.has(key);
      const re = new RegExp(
        bounded ? `(?<![A-Za-z0-9])${escapeRe(value)}(?![A-Za-z0-9])` : escapeRe(value),
        "g",
      );
      if (re.test(text)) {
        re.lastIndex = 0;
        text = text.replace(re, idToken(key));
        changed = true;
      }
    }

    if (changed) {
      assets[path] = new TextEncoder().encode(text);
      tokenizedAssets.push(path);
    }
  }

  return { assets, tokenizedAssets };
}
