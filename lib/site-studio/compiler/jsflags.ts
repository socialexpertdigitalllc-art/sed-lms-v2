import { Diagnostic } from "../schema";
import { Inventory } from "./inventory";

const DOM_WRITE_RE = /innerHTML|outerHTML\s*=|document\.write|customElements\.define|insertAdjacentHTML|\.html\(|\.append\(|\.prepend\(/;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Pass 6 (Phase-1 subset): flag JS that renders DOM and identity echoes in assets. Baking lands in Phase 2. */
export function flagJs(inv: Inventory, identity: Record<string, string>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const page of inv.pages) {
    for (const script of page.root.querySelectorAll("script")) {
      if (DOM_WRITE_RE.test(script.text)) {
        diagnostics.push({
          level: "warn", code: "js_renders_dom", page: page.file,
          message: `Inline script on ${page.file} writes to the DOM; compile-time baking lands in Phase 2 — review its output manually.`,
        });
        break;
      }
    }
  }

  for (const [path, bytes] of Object.entries(inv.assets)) {
    if (!/\.(js|css)$/i.test(path)) continue;
    const text = new TextDecoder().decode(bytes);
    if (DOM_WRITE_RE.test(text) && path.toLowerCase().endsWith(".js"))
      diagnostics.push({ level: "warn", code: "js_renders_dom", message: `${path} writes to the DOM; review its output manually.` });

    const flaggedKeys = new Set<string>();
    for (const [key, value] of Object.entries(identity)) {
      // Anti-noise threshold: below 6 chars a match is too likely to be
      // coincidental (minified vendor bundles are full of short tokens) —
      // this consciously excludes bare years ("2024") and very short names.
      if (value.length < 6) continue;

      let matched = text.includes(value);

      // Phone-like values: compare digits only, allowing arbitrary separators
      // between digits (e.g. "512.555.0147" vs "(512) 555-0147"). Scoped to
      // a digit-by-digit regex rather than a whole-file digit projection to
      // avoid false positives from unrelated concatenated numbers.
      if (!matched && /\d{3}.*\d{4}/.test(value)) {
        const digits = value.replace(/\D/g, "");
        if (digits.length >= 7) {
          const digitPattern = digits.split("").map(escapeRe).join("\\D?");
          matched = new RegExp(digitPattern).test(text);
        }
      }

      // Email-like values: case-insensitive compare.
      if (!matched && value.includes("@")) {
        matched = text.toLowerCase().includes(value.toLowerCase());
      }

      if (matched && !flaggedKeys.has(key)) {
        flaggedKeys.add(key);
        diagnostics.push({ level: "warn", code: "asset_identity_echo", message: `${path} contains demo ${key} ("${value}"); asset tokenization lands in Phase 2 — review.` });
      }
    }
  }

  return diagnostics;
}
