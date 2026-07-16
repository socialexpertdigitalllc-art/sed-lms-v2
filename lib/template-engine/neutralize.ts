// Template Engine v2 — deterministic neutralization of the demo app identifier.
//
// This template defines `class NorthpointApp` and references `window.northpointApp`
// in its JS. The structure gate (structure.ts) requires every JS identifier the
// template declared to still exist in the regenerated output — renaming one breaks
// the cross-file references the CSS/JS wiring depends on. The leak gate
// (demoTokens.ts) requires the opposite: `NorthpointApp` / `northpointApp` are
// extracted as demo tokens and must NOT survive. An AI asked to satisfy both at
// once cannot: keep the identifier and the leak gate fails; rename it and the
// structure gate fails.
//
// The fix takes the identifier out of the AI's hands entirely. This module renames
// the demo app class (and its lowercase-first instance form) to a neutral pair —
// `SiteApp` / `siteApp` — DETERMINISTICALLY and consistently across every file,
// before regeneration ever runs. Wired in before both the structure gate's baseline
// and the AI's input are captured, the demo brand is never present for either gate
// to see, so there is no conflict left to resolve.
//
// Pure: no I/O, no dependencies.

export interface Neutralized {
  files: Record<string, string>;
  renames: { from: string; to: string }[];
}

/** A `class` declaration whose name ends in "App", with at least one prefix char. */
const CLASS_APP_RE = /class\s+([A-Za-z_$][\w$]*App)\b/g;
/** A `new XxxApp(...)` construction — catches files that use the class without declaring it. */
const NEW_APP_RE = /new\s+([A-Za-z_$][\w$]*App)\b/g;
/** A `window.xxxApp` global — usually the lowercase-first instance form. */
const WINDOW_APP_RE = /window\.([A-Za-z_$][\w$]*App)\b/g;

const toPascal = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);
const toCamel = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1);
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Rename brand-named JS "app" identifiers (e.g. NorthpointApp / northpointApp) to a
 * neutral pair (SiteApp / siteApp) across ALL files, consistently. These are internal
 * code symbols, never visitor-visible, but they carry the demo brand and are required
 * (unchanged) by the structure gate — so a deterministic rename removes the brand
 * without any gate conflict. Only class-style identifiers with a prefix before "App"
 * are touched (a generic `class App` is left alone).
 */
export function neutralizeAppIdentifier(files: Record<string, string>): Neutralized {
  // Discover every distinct "Xxx App" identifier, normalized to its PascalCase
  // class-name spelling, in first-seen order across all three signal shapes.
  const pascalNames: string[] = [];
  const seen = new Set<string>();
  const noteMatch = (raw: string): void => {
    const pascal = toPascal(raw);
    if (seen.has(pascal)) return;
    seen.add(pascal);
    pascalNames.push(pascal);
  };

  const contents = Object.values(files);
  for (const re of [CLASS_APP_RE, NEW_APP_RE, WINDOW_APP_RE]) {
    for (const content of contents) {
      for (const m of content.matchAll(re)) noteMatch(m[1]);
    }
  }

  if (pascalNames.length === 0) return { files: { ...files }, renames: [] };

  // Assign each distinct class its neutral pair: SiteApp/siteApp, then
  // SiteApp2/siteApp2, etc. for any additional distinct classes.
  const renames: { from: string; to: string }[] = [];
  const replacements: { from: string; to: string }[] = [];
  pascalNames.forEach((pascal, i) => {
    const suffix = i === 0 ? "" : String(i + 1);
    const targetPascal = `SiteApp${suffix}`;
    const targetCamel = `siteApp${suffix}`;
    const camel = toCamel(pascal);
    renames.push({ from: pascal, to: targetPascal });
    replacements.push({ from: pascal, to: targetPascal });
    if (camel !== pascal) {
      renames.push({ from: camel, to: targetCamel });
      replacements.push({ from: camel, to: targetCamel });
    }
  });

  const outFiles: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    let next = content;
    for (const { from, to } of replacements) {
      next = next.replace(new RegExp(`\\b${escapeRegExp(from)}\\b`, "g"), to);
    }
    outFiles[path] = next;
  }

  return { files: outFiles, renames };
}
