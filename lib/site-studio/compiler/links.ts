import { Diagnostic } from "../schema";
import { linkToken } from "../tokens";
import { Inventory } from "./inventory";

const isRawInternal = (href: string) =>
  !!href && !/^(https?:|mailto:|tel:|#|\{\{)/.test(href);

/** Pass 4b: remaining internal <a href> targeting a known page file → {{link:pageId}}. */
export function tokenizeInternalLinks(inv: Inventory): Diagnostic[] {
  const idByFile = new Map(inv.pages.map((p) => [p.file, p.id]));
  for (const page of inv.pages) {
    for (const a of page.root.querySelectorAll("a")) {
      const href = a.getAttribute("href") ?? "";
      if (!isRawInternal(href)) continue;
      const clean = href.replace(/^\.\//, "").split(/[?#]/)[0];
      const target = idByFile.get(clean);
      if (target) a.setAttribute("href", linkToken(target));
    }
  }
  return [];
}
