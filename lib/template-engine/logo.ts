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
// Uses a real HTML parser (node-html-parser) — never regex — because this runs
// on every page of every site and hand-rolled HTML rewriting corrupts markup in
// ways nobody spots until a client does. Pure: no I/O.

import { parse, type HTMLElement } from "node-html-parser";

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

function applyToRegion(region: HTMLElement, args: LogoArgs): boolean {
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
  (anchor ?? area).insertAdjacentHTML("afterbegin", img);
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
  const didHeader = header ? applyToRegion(header, clean) : false;
  const didFooter = footer ? applyToRegion(footer, clean) : false;
  if (!didHeader && !didFooter) return { html, header: false, footer: false };
  return { html: root.toString(), header: didHeader, footer: didFooter };
}
