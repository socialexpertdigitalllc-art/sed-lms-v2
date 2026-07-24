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

/** Pass 5: map the template's colors to named roles. */
export function extractTheme(files: FileMap): { theme: ThemeDef; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const css = cssAssets(files).map(([, s]) => s).join("\n");

  // Path 1: custom properties ranked by var() usage
  const decls = [...css.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\b/g)]
    .map(([, name, hex]) => ({ name, hex: hex.toLowerCase() }))
    .filter((d) => !isNeutralHex(d.hex));
  if (decls.length > 0) {
    const ranked = decls
      .map((d) => ({ ...d, uses: (css.match(new RegExp(`var\\(${d.name}\\)`, "g")) ?? []).length }))
      .sort((a, b) => b.uses - a.uses);
    const roles: ThemeDef["roles"] = {};
    ROLE_ORDER.forEach((role, i) => { if (ranked[i]) roles[role] = { var: ranked[i].name, hex: ranked[i].hex }; });
    return { theme: { mode: "css_vars", roles }, diagnostics };
  }

  // Path 2: literal hex frequency
  const counts = new Map<string, number>();
  for (const [, hex] of css.matchAll(/(#[0-9a-fA-F]{3,6})\b/g)) {
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
