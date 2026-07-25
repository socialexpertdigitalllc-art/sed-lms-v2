import type { ThemeDef } from "../schema";

/** Roles are assigned in this priority order, skipping any the manifest
 *  doesn't declare. */
const ROLE_ORDER = ["brand", "brand_deep", "accent"] as const;

const HEX_RE = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;

function normaliseHex(raw: string): string {
  const hex = raw.slice(1).toLowerCase();
  if (hex.length === 3) {
    const [r, g, b] = hex.split("");
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return `#${hex}`;
}

/** Extracts explicit hex colours from the lead's free-text colour_scheme and
 *  assigns them, in the order found, to the manifest's declared theme roles
 *  (brand, brand_deep, accent). No hex found -> {} (the renderer then keeps
 *  the template's own palette). Never guesses a colour from words: "navy"
 *  could be any of a hundred hexes, so unless the text spells out a real hex
 *  code, nothing is derived. Pure. */
export function deriveTheme(colorScheme: string | undefined, manifestTheme: ThemeDef): Record<string, string> {
  if (!colorScheme) return {};

  const found = colorScheme.match(HEX_RE);
  if (!found || found.length === 0) return {};

  const hexes = found.map(normaliseHex);

  const result: Record<string, string> = {};
  let i = 0;
  for (const role of ROLE_ORDER) {
    if (i >= hexes.length) break;
    if (!(role in manifestTheme.roles)) continue;
    result[role] = hexes[i];
    i++;
  }
  return result;
}
