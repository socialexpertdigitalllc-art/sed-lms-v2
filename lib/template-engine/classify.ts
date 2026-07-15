// Template Engine v2 — how every file in a template is treated during
// customization. Pure: no I/O, no dependencies. Consumed by the v2 runner.

export interface FileClasses {
  content: string[];
  passthrough: string[];
}

/**
 * Every HTML page AND every non-vendor JS file is content.
 *
 * The `js` arm is the whole point of this module. v1 only ever AI-edited the
 * manifest's HTML pages plus `components.js` (`runner.ts:528-536`), then copied
 * every other text file through untouched at finalize (`runner.ts:573-577`).
 * `script.js` therefore shipped byte-for-byte in every single client site — and
 * that is exactly where the template parks its testimonial arrays, service data
 * and the `NorthpointApp` identity. The demo business leaked no matter what the
 * pages said. Any file we do not regenerate is a file that still belongs to the
 * demo business, so JS is regenerated like HTML is.
 */
const CONTENT_RE = /\.(html?|js|mjs)$/i;

/**
 * Vendor directories are third-party code we neither own nor rewrite. Rewriting
 * them wastes tokens at best and breaks the site at worst.
 */
const VENDOR_RE = /(^|\/)(vendor|lib|libs|dist)\//i;

/**
 * Minified bundles are vendor code wherever they sit — no template author
 * hand-writes a `.min.js`, and an LLM cannot meaningfully rewrite one.
 */
const MIN_RE = /\.min\.(js|mjs)$/i;

/**
 * content     — regenerated wholesale by the AI (all HTML + all content JS).
 * passthrough — copied byte-for-byte: CSS (design preserved by construction),
 *               images/binaries, and minified vendor bundles.
 *
 * CSS is never content: the design is preserved by construction, not by asking
 * the model nicely. A byte-identical `style.css` is a success criterion of v2.
 *
 * Paths are the normalized, forward-slash, template-relative keys produced by
 * `unzipToMap` / the runner's storage listing. Every input lands in exactly one
 * bucket, and input order is preserved within each.
 */
export function classifyFiles(files: string[]): FileClasses {
  const content: string[] = [];
  const passthrough: string[] = [];
  for (const f of files) {
    if (CONTENT_RE.test(f) && !MIN_RE.test(f) && !VENDOR_RE.test(f)) content.push(f);
    else passthrough.push(f);
  }
  return { content, passthrough };
}
