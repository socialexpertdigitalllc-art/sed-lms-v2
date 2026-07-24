import { HTMLElement, NodeType } from "node-html-parser";
import { Diagnostic, NavRegionDef } from "../schema";
import { navMarker, NAV_HREF, NAV_TITLE } from "../tokens";
import { Inventory } from "./inventory";

const isInternal = (href: string) =>
  !!href && !/^(https?:|mailto:|tel:|#|\{\{)/.test(href);

function locationOf(el: HTMLElement): NavRegionDef["location"] {
  let cur: HTMLElement | null = el;
  while (cur) {
    const tag = cur.rawTagName?.toLowerCase();
    if (tag === "footer") return "footer";
    if (tag === "header") return "header";
    cur = cur.parentNode as HTMLElement | null;
  }
  return "header";
}

/** Pass 4: list navs → shared nav regions with {{nav:*}} fragments. */
export function extractNav(inv: Inventory): { regions: NavRegionDef[]; fragments: Record<string, string>; diagnostics: Diagnostic[] } {
  const regions: NavRegionDef[] = [];
  const fragments: Record<string, string> = {};
  const diagnostics: Diagnostic[] = [];
  const byKey = new Map<string, string>();
  let found = false;

  for (const page of inv.pages) {
    let pageHasNav = false;
    for (const list of page.root.querySelectorAll("ul, ol")) {
      const items = list.childNodes.filter((n): n is HTMLElement =>
        n.nodeType === NodeType.ELEMENT_NODE && (n as HTMLElement).rawTagName?.toLowerCase() === "li");
      if (items.length < 2) continue;
      const links = items.map((li) => {
        const as = li.querySelectorAll("a");
        return as.length === 1 && isInternal(as[0].getAttribute("href") ?? "") ? as[0] : null;
      });
      if (links.some((l) => l === null)) continue;

      const location = locationOf(list);
      const key = `${location}:${items.length}`;
      let id = byKey.get(key);
      if (!id) {
        id = `nav_${location}${byKey.size ? `_${byKey.size}` : ""}`;
        byKey.set(key, id);
        const fragLi = items[0].clone() as HTMLElement;
        const a = fragLi.querySelector("a")!;
        a.setAttribute("href", NAV_HREF);
        a.set_content(NAV_TITLE);
        fragments[id] = fragLi.toString();
        regions.push({ id, fragment: id, location });
      }
      list.set_content(navMarker(id));
      pageHasNav = true;
      found = true;
    }
    if (!pageHasNav)
      diagnostics.push({ level: "warn", code: "nav_not_detected", page: page.file, message: `No list nav detected on ${page.file}; its links will degrade to plain slots/links — review manually.` });
  }

  if (!found && inv.pages.length > 0)
    diagnostics.push({ level: "warn", code: "nav_not_detected", message: "No nav regions detected anywhere in the template" });

  return { regions, fragments, diagnostics };
}
