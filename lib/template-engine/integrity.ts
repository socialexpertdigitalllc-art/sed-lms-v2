// Template Engine v2 — final site-integrity pass: no internal link may 404.
//
// pruneNavToBuiltPages fixes the menus it can SEE — anchors in static HTML.
// The failure that motivated this module was invisible to it: the Northpoint
// template renders its header nav from `components.js` (JS custom elements),
// so the "Service Areas" menu item lived in a JS string literal, survived
// every static pass, and pointed at a page the build had not produced. One
// click: 404.
//
// This pass closes that hole structurally rather than template-by-template.
// It collects every internal `.html` reference in the FINAL file set — HTML
// `href`/`src` attribute values AND JS string literals that are path-shaped —
// and for each referenced target that does not exist in the set it emits a
// redirect stub page at that path: a minimal valid document that immediately
// forwards to the site's index (meta refresh + `location.replace` fallback +
// a plain link), titled with the business name. However a template renders
// its nav (static markup, JS custom elements, data attributes), a click can
// land on a real page but never a 404.
//
// Runs unconditionally on every build (see runnerV2's finalize: gates ->
// theme -> logo -> nav prune -> integrity -> package) and is idempotent: a
// stub references only a page that exists, so a second pass adds nothing.
//
// What counts as an internal page reference is nav.ts's internalPageTarget —
// never externals, in-page anchors, mailto:/tel:, or non-.html assets.
//
// Pure: no I/O.

import { parse } from "node-html-parser";
import { PARSE_OPTIONS } from "./logo";
import { internalPageTarget } from "./nav";
import { extractJsStrings } from "./jsStrings";

export interface IntegrityReport {
  /** Paths of the redirect stub pages emitted, sorted. */
  stubs: string[];
  /** stub path -> files whose references forced it into existence. */
  referencedBy: Record<string, string[]>;
}

export interface IntegrityResult {
  /** Redirect stub pages to add to the site, path -> HTML. */
  added: Record<string, string>;
  report: IntegrityReport;
}

const HTML_FILE = /\.html?$/i;
const JS_FILE = /\.[cm]?js$/i;

/**
 * A JS string literal counts as a page reference only when the WHOLE literal
 * is a path — prose that happens to mention "about.html" is copy, not a link.
 */
const PATHLIKE = /^[\w./#?=&%-]+$/;

/** Same normalization internalPageTarget applies to its result. */
function normalizePath(p: string): string {
  return String(p).replace(/^\.?\//, "").toLowerCase();
}

/** Internal page targets referenced by an HTML document's href/src attributes. */
function collectHtmlRefs(html: string): string[] {
  const out: string[] = [];
  const root = parse(html, PARSE_OPTIONS);
  for (const el of root.querySelectorAll("*")) {
    for (const attr of ["href", "src"] as const) {
      const target = internalPageTarget(el.getAttribute(attr));
      if (target) out.push(target);
    }
  }
  return out;
}

/** Internal page targets held in a JS file's string literals (e.g. a nav array). */
function collectJsRefs(js: string): string[] {
  const out: string[] = [];
  for (const item of extractJsStrings(js).items) {
    const text = item.text.trim();
    if (!PATHLIKE.test(text)) continue;
    const target = internalPageTarget(text);
    if (target) out.push(target);
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The minimal, valid page a dangling reference lands on instead of a 404. */
export function redirectStub(args: { redirectTo: string; businessName: string }): string {
  const name = escapeHtml(args.businessName.trim() || "Home");
  const url = escapeHtml(args.redirectTo);
  const jsUrl = args.redirectTo.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<meta http-equiv="refresh" content="0;url=${url}">`,
    `<title>${name}</title>`,
    "</head>",
    "<body>",
    `<p><a href="${url}">${name}</a></p>`,
    `<script>location.replace("${jsUrl}");</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/**
 * Scan the final file set and emit a redirect stub for every internal `.html`
 * reference whose target is missing from it.
 *
 * `textFiles` are the text files to SCAN (and the stubs merge into them);
 * `allPaths` is the COMPLETE final path set — text and binary — used to decide
 * whether a target exists. Matching is case-insensitive and `./`-insensitive,
 * mirroring internalPageTarget.
 */
export function ensureSiteIntegrity(args: {
  textFiles: Record<string, string>;
  allPaths: Iterable<string>;
  businessName: string;
}): IntegrityResult {
  const { textFiles, allPaths, businessName } = args;
  const present = new Set<string>();
  for (const p of allPaths) present.add(normalizePath(p));

  const referencedBy: Record<string, string[]> = {};
  for (const [path, content] of Object.entries(textFiles)) {
    const refs = HTML_FILE.test(path) ? collectHtmlRefs(content) : JS_FILE.test(path) ? collectJsRefs(content) : [];
    for (const target of refs) {
      if (present.has(target)) continue;
      (referencedBy[target] ??= []).push(path);
    }
  }

  const stubs = Object.keys(referencedBy).sort();
  // Where a stub sends the visitor: the site index when it exists, else the
  // first page that does. A stub always redirects to a PRESENT page (and a
  // missing page is never present), so a stub can never redirect to itself
  // and a re-run finds every stub reference resolved: idempotence.
  const htmlPresent = [...present].filter((p) => HTML_FILE.test(p)).sort();
  const home = present.has("index.html") ? "index.html" : (htmlPresent[0] ?? "index.html");

  const added: Record<string, string> = {};
  for (const stub of stubs) {
    referencedBy[stub] = [...new Set(referencedBy[stub])];
    // A stub in a subdirectory must climb back out to reach the site root.
    const depth = stub.split("/").length - 1;
    added[stub] = redirectStub({ redirectTo: "../".repeat(depth) + home, businessName });
  }

  return { added, report: { stubs, referencedBy } };
}
