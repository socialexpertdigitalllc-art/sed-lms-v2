/**
 * Tag accent colors.
 *
 * Values are literal hex used via inline `style`, NOT Tailwind palette classes.
 * This app's Tailwind v4 theme overrides many color tokens with custom design
 * tokens (accent/surface/ready/dropped/…), so `bg-red-500`-style utilities are
 * not guaranteed to exist and dynamic class names would be purged anyway.
 * Inline hex renders identically in light and dark themes.
 *
 * Each color exposes:
 *  - `hex`    the solid dot / accent color
 *  - `chipBg` a soft translucent wash for chip backgrounds
 *  - `chipFg` readable chip text color (the hue itself)
 */
export type TagColorDef = { key: string; hex: string; chipBg: string; chipFg: string };

const HEX: Record<string, string> = {
  slate: "#64748b",
  red: "#ef4444",
  amber: "#f59e0b",
  green: "#22c55e",
  teal: "#14b8a6",
  blue: "#3b82f6",
  purple: "#a855f7",
  pink: "#ec4899",
};

function def(key: string, hex: string): TagColorDef {
  // `hex + "22"` = ~13% alpha wash; `hex + "55"` (used for borders) ~33%.
  return { key, hex, chipBg: hex + "22", chipFg: hex };
}

export const TAG_COLORS: Record<string, TagColorDef> = Object.fromEntries(
  Object.entries(HEX).map(([k, hex]) => [k, def(k, hex)])
);

export const TAG_COLOR_KEYS: string[] = Object.keys(TAG_COLORS);

/** Resolve a color key to its definition, falling back to slate. */
export function tagColor(key: string | null | undefined): TagColorDef {
  return (key && TAG_COLORS[key]) || TAG_COLORS.slate;
}
