import { FileMap, ThemeDef } from "../schema";

/**
 * Apply the operator/lead theme to the template's assets.
 * css_vars → emit studio-theme.css overriding the mapped variables (caller injects the <link>).
 * literal_remap → rewrite the original hexes inside css assets.
 * none / empty docTheme → untouched.
 */
export function applyTheme(
  assets: FileMap, theme: ThemeDef, docTheme: Record<string, string>,
): { assets: FileMap; injectCssFile?: string } {
  const entries = Object.entries(docTheme).filter(([role]) => theme.roles[role]);
  if (theme.mode === "none" || entries.length === 0) return { assets };

  if (theme.mode === "css_vars") {
    const lines = entries.map(([role, hex]) => `  ${theme.roles[role].var}: ${hex};`);
    return {
      assets: { ...assets, "studio-theme.css": new TextEncoder().encode(`:root {\n${lines.join("\n")}\n}\n`) },
      injectCssFile: "studio-theme.css",
    };
  }

  // literal_remap
  const out: FileMap = { ...assets };
  for (const [path, bytes] of Object.entries(assets)) {
    if (!path.toLowerCase().endsWith(".css")) continue;
    let css = new TextDecoder().decode(bytes);
    for (const [role, hex] of entries) css = css.split(theme.roles[role].hex).join(hex);
    out[path] = new TextEncoder().encode(css);
  }
  return { assets: out };
}
