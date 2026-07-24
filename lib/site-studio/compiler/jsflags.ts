import { Diagnostic } from "../schema";
import { Inventory } from "./inventory";

const DOM_WRITE_RE = /innerHTML|document\.write|customElements\.define|insertAdjacentHTML/;

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
    for (const [key, value] of Object.entries(identity)) {
      if (value.length >= 6 && text.includes(value))
        diagnostics.push({ level: "warn", code: "asset_identity_echo", message: `${path} contains demo ${key} ("${value}"); asset tokenization lands in Phase 2 — review.` });
    }
  }

  return diagnostics;
}
