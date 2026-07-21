// Template Engine v2 — remove menu links to pages that were never built.
//
// pageSelect.ts builds only the pages the client asked for, but the template's
// nav still lists every page the template ships. On the original template the
// client happened to want the lot; ask for a subset and the menu links straight
// into 404s. The AI cannot fix this — the structure gate forbids removing
// elements, so any pruning attempt inside regeneration fails the build.
//
// So it is done here, deterministically, AFTER the gate has passed (see the
// call site in runnerV2's finalize step): once the gate has proven the model
// preserved the template's structure, shrinking the menu is our own trusted
// transformation.
//
// Uses a real HTML parser (node-html-parser) — never regex. Pure: no I/O.

import { parse, type HTMLElement } from "node-html-parser";
import { PARSE_OPTIONS } from "./logo";

/** Anything with one of these prefixes is not an internal page link. */
const NON_PAGE = /^(?:#|mailto:|tel:|sms:|javascript:|data:)/i;

/** class names that mark an element as a menu container. */
const MENU_CLASS = /(?:^|[\s_-])(?:nav|navbar|navigation|menu)(?:[\s_-]|$)/i;

/**
 * The page file an href points at, or null if it is not an internal page link
 * (external URL, in-page anchor, mailto:/tel:, an asset, a directory index).
 * Exported for tests.
 */
export function internalPageTarget(href: string | undefined): string | null {
  if (typeof href !== "string") return null;
  const raw = href.trim();
  if (raw.length === 0 || NON_PAGE.test(raw)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) return null; // absolute/external
  const path = raw.split("#")[0].split("?")[0];
  if (!/\.html?$/i.test(path)) return null;
  // Normalize away leading ./ and / so "./about.html" and "/about.html" both
  // resolve to the same built file.
  return path.replace(/^\.?\//, "").toLowerCase();
}

/**
 * Is this anchor part of a menu? Only menus are pruned — a stale link in body
 * copy is the AI's business, and silently deleting page content is not
 * something this pass should ever do.
 */
function menuRootOf(a: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = a.parentNode;
  let last: HTMLElement | null = null;
  while (el && el.tagName) {
    const cls = el.getAttribute("class") ?? "";
    const role = el.getAttribute("role") ?? "";
    if (el.tagName === "NAV" || MENU_CLASS.test(cls) || role === "navigation" || role === "menubar") {
      last = el;
    }
    el = el.parentNode;
  }
  return last; // outermost nav/menu ancestor — the unit the "don't empty it" guard protects
}

/** The element to delete for a menu entry: the enclosing <li>, else the anchor. */
function removalUnit(a: HTMLElement, menu: HTMLElement): HTMLElement {
  let el: HTMLElement | null = a.parentNode;
  while (el && el.tagName && el !== menu) {
    if (el.tagName === "LI") return el;
    el = el.parentNode;
  }
  return a;
}

export interface NavPruneResult {
  html: string;
  /** Page targets removed from the menus, e.g. ["gallery.html"]. */
  removed: string[];
  /** Menus left alone because pruning would have emptied them (for logging). */
  keptEmptyGuard: string[];
}

/**
 * Remove menu items pointing at pages that are not in `builtPages`.
 * Operates document-wide, so a template's second (mobile) nav is pruned too.
 * A menu that would be emptied entirely is left untouched and reported — a
 * stale link is bad, a menu with nothing in it is worse.
 */
export function pruneNavToBuiltPages(html: string, builtPages: Iterable<string>): NavPruneResult {
  const built = new Set<string>();
  for (const p of builtPages) built.add(String(p).replace(/^\.?\//, "").toLowerCase());

  const root = parse(html, PARSE_OPTIONS);
  // Group doomed anchors by their menu so the "would empty it" guard can weigh
  // each menu on its own — pruning the desktop nav must not depend on what the
  // mobile nav happens to contain.
  const byMenu = new Map<HTMLElement, { doomed: HTMLElement[]; targets: string[]; total: number }>();

  for (const a of root.querySelectorAll("a")) {
    const menu = menuRootOf(a);
    if (!menu) continue;
    let entry = byMenu.get(menu);
    if (!entry) {
      entry = { doomed: [], targets: [], total: menu.querySelectorAll("a").length };
      byMenu.set(menu, entry);
    }
    const target = internalPageTarget(a.getAttribute("href"));
    if (target === null || built.has(target)) continue;
    entry.doomed.push(a);
    entry.targets.push(target);
  }

  const removed: string[] = [];
  const keptEmptyGuard: string[] = [];
  let changed = false;
  for (const [menu, entry] of byMenu) {
    if (entry.doomed.length === 0) continue;
    if (entry.doomed.length >= entry.total) {
      keptEmptyGuard.push(entry.targets.join(", "));
      continue;
    }
    for (const a of entry.doomed) removalUnit(a, menu).remove();
    removed.push(...entry.targets);
    changed = true;
  }

  return {
    html: changed ? root.toString() : html,
    removed: [...new Set(removed)],
    keptEmptyGuard,
  };
}
