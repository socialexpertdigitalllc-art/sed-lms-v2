import { parse } from "node-html-parser";
import type { CompiledTemplate, ContentDoc } from "../schema";
import { renderSite } from "../render/renderer";

export interface BuildPreviewSuccess {
  ok: true;
  html: string;
  /** Non-fatal problems found while building this page's preview — today,
   *  only unresolved `asset:{uuid}` image picks (a slot an operator picked
   *  but that hasn't been rehosted into a real file yet). The preview must
   *  render something useful the moment an operator needs to see what's
   *  wrong, so these never turn into a refusal; `deploy` (a later task) is
   *  where a dangling asset becomes fatal. */
  warnings: string[];
}

export interface BuildPreviewFailure {
  ok: false;
  missing: { page_id: string; slot_id: string }[];
}

export type BuildPreviewResult = BuildPreviewSuccess | BuildPreviewFailure;

/** True for a value that must be left completely alone when rewriting
 *  hrefs/srcs: empty, scheme-qualified (`https:`, `mailto:`, `tel:`, and
 *  `asset:` itself — an unresolved pick reads as a bogus URL scheme, which
 *  this same check conveniently leaves untouched), protocol-relative
 *  (`//host`), or a bare anchor (`#...`). Mirrors the renderer's own
 *  `prefixHref` guard (render/renderer.ts) for the same reason: none of these
 *  are template-relative paths this function has any business rewriting. */
function isExternal(value: string): boolean {
  return /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value);
}

/** Resolves an HTML-relative reference (`href`/`src`) against the directory
 *  of the page that contains it, the same way a browser would — so
 *  "../about.html" written on "services/x.html" becomes root-relative
 *  "about.html", matching a key in the render's FileMap. Query strings and
 *  fragments are stripped before resolving (they never appear in a FileMap
 *  key) and are not restored — every reference this function rewrites is
 *  replaced wholesale, and one left alone is returned untouched by the
 *  caller before this is ever invoked on it. */
function resolveRelative(baseDir: string, ref: string): string {
  const pathPart = ref.split(/[?#]/, 1)[0];
  const stack = baseDir ? baseDir.split("/") : [];
  for (const part of pathPart.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

/**
 * Renders the whole site annotated (renderSite is whole-site by design —
 * nav/link resolution needs every page built) and returns just ONE page's
 * HTML, ready to drop into the preview iframe:
 *  - every relative `href`/`src` that resolves to a file the render actually
 *    produced (a page, a stylesheet, an image) is rewritten to the preview's
 *    own asset route, `/api/site-studio/runs/{runId}/preview?asset=<path>`,
 *    so the sandboxed iframe (no same-origin, see service/guard.ts) can still
 *    load the package's CSS/images through this app's own origin;
 *  - a reference that resolves to ANOTHER rendered page becomes
 *    `#ss-page-<targetDocIndex>` instead, so the preview shell can intercept
 *    the click and swap pages itself rather than the iframe navigating away
 *    to a page the shell doesn't control;
 *  - anything external, scheme-qualified, protocol-relative, or a bare
 *    anchor is left exactly as rendered — there is nothing of this app's to
 *    route it through;
 *  - an unresolved `asset:{uuid}` image pick (never rehosted into a real
 *    file) is reported in `warnings` and otherwise left alone: the value
 *    already reads as an inert bogus-scheme URL (a broken image icon in the
 *    iframe), and a preview that refuses to render over one bad pick is
 *    useless at exactly the moment an operator needs to see it.
 *
 * Pure: `runId` is a parameter (never read from ambient state), the input
 * `doc` is never mutated, and the same inputs always produce the same
 * output.
 */
export function buildPreview(
  tpl: CompiledTemplate,
  doc: ContentDoc,
  pageIndex: number,
  runId: string,
): BuildPreviewResult {
  if (pageIndex < 0 || pageIndex >= doc.pages.length) {
    throw new RangeError(`buildPreview: page index ${pageIndex} is out of range (doc has ${doc.pages.length} pages)`);
  }

  const rendered = renderSite(tpl, doc, { annotate: true });
  if (!rendered.ok) return { ok: false, missing: rendered.missing };

  const defs = new Map(tpl.manifest.pages.map((p) => [p.id, p]));

  // Every doc page's OUTPUT path, in doc order — index i is the docIndex an
  // inter-page link must target. renderSite already succeeded, so every
  // page_id here is guaranteed to resolve to a real manifest def.
  const pageOutputs = doc.pages.map((page) => {
    const def = defs.get(page.page_id)!;
    return page.output ?? def.file;
  });

  const targetOutput = pageOutputs[pageIndex];
  const targetBytes = rendered.files[targetOutput];
  const html = new TextDecoder().decode(targetBytes);
  const baseDir = targetOutput.includes("/") ? targetOutput.slice(0, targetOutput.lastIndexOf("/")) : "";

  const root = parse(html);

  // Shared by every attribute-shape below (a single URL, a srcset's
  // candidate list, an inline style's url(...)): resolves ONE reference and
  // returns its replacement, or null when it must be left exactly as
  // rendered (external/scheme-qualified/anchor, or a reference this render
  // simply didn't produce — a broken template link, or an unresolved
  // asset: scheme, which `isExternal` already treats as external).
  const resolveRef = (value: string): string | null => {
    if (!value || isExternal(value)) return null;
    const resolved = resolveRelative(baseDir, value);
    const targetIndex = pageOutputs.indexOf(resolved);
    if (targetIndex !== -1) return `#ss-page-${targetIndex}`;
    if (resolved in rendered.files) return `/api/site-studio/runs/${runId}/preview?asset=${resolved}`;
    return null;
  };

  const rewrite = (el: ReturnType<typeof root.querySelector>, attr: string) => {
    if (!el) return;
    const value = el.getAttribute(attr);
    if (!value) return;
    const next = resolveRef(value);
    if (next) el.setAttribute(attr, next);
  };

  // srcset is a COMMA-separated list of "url descriptor" candidates (e.g.
  // `"img/a.jpg 1x, img/b.jpg 2x"` or `"img/a.jpg 320w, img/b.jpg 640w"`) — a
  // browser picks whichever candidate it likes and fetches that URL
  // directly, bypassing `src` entirely. Rewriting `src` alone left srcset's
  // raw template-relative paths for the sandboxed iframe to fail to load
  // (probe-confirmed by review): each candidate's URL is rewritten the same
  // way a plain `src`/`href` is, and its descriptor (the "1x"/"320w" part,
  // including its leading whitespace) is preserved verbatim.
  const rewriteSrcset = (el: ReturnType<typeof root.querySelector>) => {
    if (!el) return;
    const value = el.getAttribute("srcset");
    if (!value) return;
    const next = value
      .split(",")
      .map((candidate) => {
        const trimmed = candidate.trim();
        if (!trimmed) return trimmed;
        const spaceIdx = trimmed.search(/\s/);
        const url = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
        const descriptor = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx);
        return `${resolveRef(url) ?? url}${descriptor}`;
      })
      .join(", ");
    el.setAttribute("srcset", next);
  };

  // Inline `style="...url(...)..."` (e.g. a hand-authored hero background)
  // is the other place a relative reference hides from the href/src/srcset
  // sweep (probe-confirmed by review) — every `url(...)` in the attribute,
  // quoted or not, gets the SAME resolution the other shapes get, with the
  // original quoting (or lack of it) preserved and everything else in the
  // declaration left untouched.
  const URL_FN_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  const rewriteInlineStyle = (el: ReturnType<typeof root.querySelector>) => {
    if (!el) return;
    const value = el.getAttribute("style");
    if (!value) return;
    const next = value.replace(URL_FN_RE, (match, quote: string, url: string) => {
      const rewritten = resolveRef(url);
      return rewritten ? `url(${quote}${rewritten}${quote})` : match;
    });
    el.setAttribute("style", next);
  };

  for (const el of root.querySelectorAll("a[href]")) rewrite(el, "href");
  for (const el of root.querySelectorAll("link[href]")) rewrite(el, "href");
  for (const el of root.querySelectorAll("img[src]")) rewrite(el, "src");
  for (const el of root.querySelectorAll("[srcset]")) rewriteSrcset(el);
  for (const el of root.querySelectorAll("[style]")) rewriteInlineStyle(el);
  // script[src] is DELIBERATELY left unrewritten: the preview iframe loads
  // with `sandbox=""` (no `allow-scripts`, see service/guard.ts's
  // `untrustedContentHeaders` and Task 7's RunPreview contract) on top of
  // the server's own CSP `sandbox` directive, so no script — same-origin-
  // routed or not — ever executes inside it. Rewriting its `src` would add
  // surface area for zero behavioural benefit.

  // Unresolved asset: picks — checked against the DOC's own image slot
  // values (never re-derived from the rewritten HTML, which has already had
  // its escaping/attribute-quoting applied) so the warning always names the
  // exact slot an operator still needs to fix.
  const warnings: string[] = [];
  const page = doc.pages[pageIndex];
  const def = defs.get(page.page_id)!;
  for (const slot of def.slots) {
    if (slot.type !== "image") continue;
    const value = page.slots[slot.id];
    if (typeof value === "string" && /^asset:/.test(value)) {
      warnings.push(`slot "${slot.id}": unresolved asset reference "${value}"`);
    }
  }

  return { ok: true, html: root.toString(), warnings };
}
