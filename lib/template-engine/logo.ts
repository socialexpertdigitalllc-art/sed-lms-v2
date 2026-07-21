// Template Engine v2 — guarantee the client's logo in the header and footer.
//
// This used to be a prompt rule only (REGEN_SYSTEM), and that rule explicitly
// gave up when the template's brand area was a text wordmark with no <img>
// slot: "always keep it as the business name". On the original template there
// was always an <img>, so nobody noticed; upload a wordmark-only template and
// the lead's logo silently never appears anywhere.
//
// The product rule is simpler than the prompt's: if identity.logo_url is set,
// the header AND the footer show the logo. So it is enforced here,
// deterministically, on every built page — INSERTING an <img> when the template
// has no logo slot. That is only safe after the structure gate has passed
// (see the call site in runnerV2's finalize step): growing the tag count would
// fail the gate if it ran before, and after the gate the markup is ours to
// transform. The prompt rule stays as a first pass; this is the guarantee.
//
// The logo and the business name are mutually exclusive in the header: when
// there is a logo, the header shows the LOGO and not the name. Templates that
// already had an <img> get that from the prompt pass (it marks the separate
// wordmark `hidden`); templates where we INSERT the <img> get it here, by
// hiding the wordmark text left beside it. See hideWordmarkText.
//
// Uses a real HTML parser (node-html-parser) — never regex — because this runs
// on every page of every site and hand-rolled HTML rewriting corrupts markup in
// ways nobody spots until a client does. Pure: no I/O.

import { parse, NodeType, type HTMLElement, type Node } from "node-html-parser";

/** Parse options that make toString() a byte-faithful round-trip. */
export const PARSE_OPTIONS = {
  comment: true,
  blockTextElements: { script: true, noscript: true, style: true, pre: true, textarea: true },
} as const;

export interface LogoArgs {
  /** identity.logo_url — empty means "no logo", and nothing is changed. */
  logoUrl: string;
  /** identity.name — used as the inserted <img>'s alt text. */
  businessName: string;
}

/**
 * Only http(s), protocol-relative, and same-site relative URLs may become an
 * `src`. Anything else (javascript:, data:, garbage a lead pasted) is refused
 * outright rather than sanitized, so nothing typed into the CRM can execute.
 */
export function isSafeLogoUrl(url: unknown): boolean {
  if (typeof url !== "string") return false;
  const v = url.trim();
  if (v.length === 0 || /[\s"'<>]/.test(v)) return false;
  if (v.startsWith("//") || v.startsWith("/") || v.startsWith("./") || v.startsWith("../")) return true;
  if (/^https?:\/\//i.test(v)) return true;
  return /^[\w.-]+(?:\/|$)/.test(v) && !v.includes(":"); // bare relative path
}

/** Minimal, correct escaping for a double-quoted attribute value. */
function attr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Region roots, most specific first. `header`/`footer` tags win; the class
// fallbacks cover templates that build their chrome out of divs.
const HEADER_SELECTORS = ["header", ".site-header", ".header", "#header", ".navbar", ".topbar"];
const FOOTER_SELECTORS = ["footer", ".site-footer", ".footer", "#footer"];

// The brand area inside a region: whatever the template calls its logo lockup.
const BRAND_SELECTORS = [
  ".brand",
  ".logo",
  ".site-brand",
  ".site-logo",
  ".navbar-brand",
  ".site-title",
  '[class*="brand"]',
  '[class*="logo"]',
];

function firstMatch(root: HTMLElement, selectors: string[]): HTMLElement | null {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (el) return el;
  }
  return null;
}

/**
 * The element the logo belongs in. Prefer a declared brand/logo element; fall
 * back to the region's first anchor (the near-universal "logo links home"
 * pattern); fall back to the region itself.
 */
function brandArea(region: HTMLElement): HTMLElement {
  return firstMatch(region, BRAND_SELECTORS) ?? region.querySelector("a") ?? region;
}

// Tags a template may legitimately wrap the wordmark text in. Anything else
// beside the logo (nav, ul, button, svg, a second link…) means the brand area
// holds more than the business name, and we leave it all visible.
const WORDMARK_TAGS = new Set(["SPAN", "B", "STRONG", "EM", "I", "SMALL", "H1", "H2", "H3", "H4", "H5", "H6", "P"]);

/** True when `el` is an inline-ish wrapper holding nothing but wordmark text. */
function isTextOnlyWrapper(el: HTMLElement): boolean {
  if (!WORDMARK_TAGS.has(el.tagName ?? "")) return false;
  // Nested markup gets the same treatment — one stray <img> or link and we bail.
  return el.querySelectorAll("*").every((child) => WORDMARK_TAGS.has(child.tagName ?? ""));
}

function hasText(node: Node): boolean {
  return node.text.trim().length > 0;
}

/**
 * Suppress the business-name text that sits beside a freshly inserted logo.
 *
 * The product rule is that the header shows the logo INSTEAD of the name, so
 * once an <img> is in the brand area the wordmark text next to it is a visible
 * duplicate. Nothing is ever deleted — the text is hidden, so it stays in the
 * DOM and the change is recoverable — and the logo carries the name as `alt`,
 * which is what keeps the name available to screen readers and crawlers.
 *
 * `host` is the element the <img> was inserted into, so it is never itself
 * hidden (that would hide the logo); only its other children are candidates.
 * Deliberately timid: if the brand area holds anything we cannot confidently
 * read as "just the name", everything stays visible. A logo next to the name is
 * a cosmetic miss; a hidden nav or tagline is a broken page.
 */
function hideWordmarkText(host: HTMLElement, logo: HTMLElement): void {
  const rest = host.childNodes.filter((n) => n !== logo);
  // Comments render nothing, so they neither block us nor need hiding.
  const visible = rest.filter((n) => n.nodeType !== NodeType.COMMENT_NODE && hasText(n));
  if (visible.length === 0) return; // nothing beside the logo — already logo-only

  // Exactly one element beside the logo: the template already wrapped the name
  // for us, so mark that wrapper (never the host, which now holds the <img>).
  if (visible.length === 1 && visible[0].nodeType === NodeType.ELEMENT_NODE) {
    const wrapper = visible[0] as HTMLElement;
    if (isTextOnlyWrapper(wrapper)) wrapper.setAttribute("hidden", "");
    return;
  }
  // Otherwise only bare text qualifies. Any element mixed in with it could be a
  // tagline, a phone number, a nav — things we must not hide — and we have no
  // way to tell which run of text is the name, so nothing is touched.
  if (!visible.every((n) => n.nodeType === NodeType.TEXT_NODE)) return;
  // Bare text needs a wrapper to hang `hidden` on. Safe to re-serialise the
  // host here precisely because everything left in it is text.
  const kept = rest.map((n) => n.toString()).join("");
  host.set_content(`${logo.toString()}<span class="tev2-name" hidden>${kept}</span>`, PARSE_OPTIONS);
}

/**
 * Navigation between the brand element and the anchor we inserted into means
 * that anchor is a menu link, not the wordmark — hiding its text would delete a
 * nav item from view. The brand element itself is exempt: `.navbar-brand` is a
 * brand, not a nav.
 */
function sitsInNavigation(host: HTMLElement, area: HTMLElement): boolean {
  if (host === area) return false;
  for (let el = host.parentNode; el && el !== area; el = el.parentNode) {
    if (["NAV", "UL", "OL", "LI", "MENU"].includes(el.tagName ?? "")) return true;
    if (/nav|menu/i.test(el.getAttribute("class") ?? "")) return true;
  }
  return false;
}

function applyToRegion(region: HTMLElement, args: LogoArgs, hideWordmark: boolean): boolean {
  const area = brandArea(region);
  const existing = area.querySelector("img") ?? (area.tagName === "IMG" ? area : null);
  if (existing) {
    existing.setAttribute("src", args.logoUrl);
    if (!existing.getAttribute("alt")) existing.setAttribute("alt", args.businessName);
    return true;
  }
  // No logo slot at all: insert one. Kept deliberately minimal and
  // style-neutral so it inherits the template's own header/footer styling —
  // the only inline style is a max-height guard, without which a 2000px logo
  // would blow the chrome apart on a template that never expected an image.
  const img =
    `<img class="tev2-logo" src="${attr(args.logoUrl)}" alt="${attr(args.businessName)}"` +
    ` style="max-height:56px;width:auto;vertical-align:middle;">`;
  // Reuse the wordmark's own anchor when there is one, so the logo keeps the
  // "click the brand to go home" behaviour the template already had.
  const anchor = area.tagName === "A" ? area : area.querySelector("a");
  const host = anchor ?? area;
  host.insertAdjacentHTML("afterbegin", img);
  // The logo now stands in for the name, so the name text beside it goes.
  // Guarded four ways, because over-hiding breaks a page and under-hiding is
  // only cosmetic:
  //   - header only — a footer commonly shows the logo AND the name;
  //   - only with a real business name, since the <img> alt is what keeps the
  //     name available to screen readers and search once the text is invisible;
  //   - only inside a brand element we actually identified (`area === region`
  //     is the last-ditch fallback, where the "wordmark" could be anything);
  //   - never into a nav link that merely happened to be the region's first <a>.
  if (
    hideWordmark &&
    args.businessName.trim().length > 0 &&
    area !== region &&
    !sitsInNavigation(host, area)
  ) {
    const inserted = host.querySelector("img.tev2-logo");
    if (inserted) hideWordmarkText(host, inserted);
  }
  return true;
}

export interface LogoResult {
  html: string;
  header: boolean;
  footer: boolean;
}

/**
 * Ensure the logo shows in the header and footer of one page.
 * No-op (byte-identical output) when the lead has no usable logo URL — the
 * business name simply stays as it is.
 */
export function applyLogoToHtml(html: string, args: LogoArgs): LogoResult {
  if (!isSafeLogoUrl(args.logoUrl)) return { html, header: false, footer: false };
  const root = parse(html, PARSE_OPTIONS);
  const header = firstMatch(root, HEADER_SELECTORS);
  const footer = firstMatch(root, FOOTER_SELECTORS);
  const clean: LogoArgs = { logoUrl: args.logoUrl.trim(), businessName: args.businessName || "" };
  const didHeader = header ? applyToRegion(header, clean, true) : false;
  const didFooter = footer ? applyToRegion(footer, clean, false) : false;
  if (!didHeader && !didFooter) return { html, header: false, footer: false };
  return { html: root.toString(), header: didHeader, footer: didFooter };
}
