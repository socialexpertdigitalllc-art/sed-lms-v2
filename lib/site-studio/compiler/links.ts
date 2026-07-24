import { Diagnostic } from "../schema";
import { linkToken } from "../tokens";
import { Inventory } from "./inventory";

const isRawInternal = (href: string) =>
  !!href && !/^(https?:|mailto:|tel:|#|\{\{)/.test(href);

// A raw internal href whose (query/fragment-stripped) path looks like a page
// file — used to decide whether an unresolved link deserves a diagnostic
// (a typo'd "servics.html") vs. staying silent (a legit "brochure.pdf").
const looksLikePage = (path: string) => /\.html?$/i.test(path);

/** Pass 4b: remaining internal <a href> targeting a known page file → {{link:pageId}}. */
export function tokenizeInternalLinks(inv: Inventory): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  // Case-folded lookup: "About.html" must resolve to a page actually named
  // "about.html" — case-sensitive hosts 404 otherwise.
  const idByFile = new Map(inv.pages.map((p) => [p.file.toLowerCase(), p.id]));
  for (const page of inv.pages) {
    for (const a of page.root.querySelectorAll("a")) {
      const href = a.getAttribute("href") ?? "";
      if (!isRawInternal(href)) continue;
      // Preserve any ?query/#fragment suffix — it must survive on the token
      // verbatim so the renderer's exact-string split leaves it in place.
      const suffixMatch = href.match(/[?#].*$/);
      const suffix = suffixMatch ? suffixMatch[0] : "";
      const clean = href.replace(/^\.\//, "").split(/[?#]/)[0];
      const target = idByFile.get(clean.toLowerCase());
      if (target) {
        a.setAttribute("href", linkToken(target) + suffix);
      } else if (looksLikePage(clean)) {
        diagnostics.push({
          level: "info",
          code: "link_unresolved",
          page: page.file,
          message: `Internal link "${href}" on ${page.file} does not resolve to any page in this template`,
        });
      }
    }
  }
  return diagnostics;
}
