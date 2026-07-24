import { HTMLElement, NodeType } from "node-html-parser";
import { Diagnostic, NavRegionDef } from "../schema";
import { navMarker, NAV_HREF, NAV_TITLE } from "../tokens";
import { Inventory } from "./inventory";

const isInternal = (href: string) =>
  !!href && !/^(https?:|mailto:|tel:|#|\{\{)/.test(href);

const NAV_CLASS_RE = /\b(nav|navbar|navigation|menu)\b/i;
const NAV_ROLE_RE = /^(navigation|menubar)$/i;
const ACTIVE_CLASS_RE = /\b(active|current[a-z-]*|is-active)\b/i;

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

/**
 * A list only qualifies as a nav CANDIDATE if it (or an ancestor) is a
 * semantic landmark (<nav>/<header>/<footer>), carries a nav-ish class, or
 * declares a navigation ARIA role. Plain body content lists (service areas,
 * pagination, etc.) never qualify, however nav-shaped their <li><a> markup
 * looks — they must be left alone.
 */
function isNavCandidate(list: HTMLElement): boolean {
  let cur: HTMLElement | null = list;
  while (cur) {
    const tag = cur.rawTagName?.toLowerCase();
    if (tag === "nav" || tag === "header" || tag === "footer") return true;
    const cls = cur.getAttribute?.("class") ?? "";
    if (NAV_CLASS_RE.test(cls)) return true;
    const role = cur.getAttribute?.("role") ?? "";
    if (NAV_ROLE_RE.test(role)) return true;
    cur = cur.parentNode as HTMLElement | null;
  }
  return false;
}

/** True when `list` sits inside an <li> — i.e. it's a nested dropdown
 *  submenu, not a top-level nav list in its own right. The outer list that
 *  contains it is evaluated on its own merits (and typically fails the
 *  one-anchor-per-<li> check, correctly falling back to nav_not_detected). */
function hasLiAncestor(list: HTMLElement): boolean {
  let cur: HTMLElement | null = list.parentNode as HTMLElement | null;
  while (cur) {
    if (cur.rawTagName?.toLowerCase() === "li") return true;
    cur = cur.parentNode as HTMLElement | null;
  }
  return false;
}

/** Remove active/current-page class tokens so the shared fragment doesn't
 *  bake one page's "current" state into every rendered page. */
function stripActiveClass(el: HTMLElement): void {
  const cls = el.getAttribute("class");
  if (!cls) return;
  const kept = cls.split(/\s+/).filter((tok) => tok && !ACTIVE_CLASS_RE.test(tok));
  if (kept.length) el.setAttribute("class", kept.join(" "));
  else el.removeAttribute("class");
}

const sameHrefs = (a: string[], b: string[]) =>
  a.length === b.length && a.every((h, i) => h === b[i]);

interface RegionRecord { id: string; hrefs: string[] }

/** Pass 4: list navs → shared nav regions with {{nav:*}} fragments. */
export function extractNav(inv: Inventory): { regions: NavRegionDef[]; fragments: Record<string, string>; diagnostics: Diagnostic[] } {
  const regions: NavRegionDef[] = [];
  const fragments: Record<string, string> = {};
  const diagnostics: Diagnostic[] = [];
  // At most one region per location: the first href-list seen for a
  // location wins; anything else at that location is either an exact repeat
  // (joins) or genuinely different content (left untouched, flagged).
  const byLocation = new Map<NavRegionDef["location"], RegionRecord>();
  const idByFile = new Map(inv.pages.map((p) => [p.file, p.id]));
  let found = false;

  for (const page of inv.pages) {
    let pageHasNav = false;
    for (const list of page.root.querySelectorAll("ul, ol")) {
      if (hasLiAncestor(list)) continue; // nested dropdown submenu

      const items = list.childNodes.filter((n): n is HTMLElement =>
        n.nodeType === NodeType.ELEMENT_NODE && (n as HTMLElement).rawTagName?.toLowerCase() === "li");
      if (items.length < 2) continue;
      const links = items.map((li) => {
        const as = li.querySelectorAll("a");
        return as.length === 1 && isInternal(as[0].getAttribute("href") ?? "") ? as[0] : null;
      });
      if (links.some((l) => l === null)) continue;

      if (!isNavCandidate(list)) {
        const firstHref = links[0]!.getAttribute("href") ?? "";
        diagnostics.push({
          level: "info",
          code: "nav_candidate_skipped",
          page: page.file,
          message: `List of links on ${page.file} (first href: ${firstHref}) has no nav/header/footer landmark, menu class, or navigation role — left as plain content`,
        });
        continue;
      }

      const location = locationOf(list);
      const hrefs = links.map((a) => a!.getAttribute("href") ?? "");
      const existing = byLocation.get(location);

      if (existing && sameHrefs(existing.hrefs, hrefs)) {
        list.set_content(navMarker(existing.id));
        pageHasNav = true;
        found = true;
        continue;
      }

      if (existing) {
        // Same location, different link set (e.g. a second footer column) —
        // don't merge distinct content into the shared region. Leave it as
        // real markup; the links pass will tokenize its hrefs normally.
        diagnostics.push({
          level: "warn",
          code: "nav_ambiguous",
          page: page.file,
          message: `Multiple distinct ${location} nav lists found on ${page.file}; only the first-seen link set is treated as the shared nav region — this list was left untouched`,
        });
        continue;
      }

      const id = `nav_${location}`;
      const regionItems = links.map((a) => {
        const href = a!.getAttribute("href") ?? "";
        const label = a!.text;
        const clean = href.replace(/^\.\//, "").split(/[?#]/)[0];
        return { page_id: idByFile.get(clean) ?? null, href, label };
      });
      const fragLi = items[0].clone() as HTMLElement;
      const a = fragLi.querySelector("a")!;
      stripActiveClass(fragLi);
      stripActiveClass(a);
      a.setAttribute("href", NAV_HREF);
      a.set_content(NAV_TITLE);
      fragments[id] = fragLi.toString();
      regions.push({ id, fragment: id, location, items: regionItems });
      byLocation.set(location, { id, hrefs });

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
