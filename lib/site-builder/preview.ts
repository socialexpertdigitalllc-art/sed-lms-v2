/**
 * Preview-only asset reference rewriting.
 *
 * The deployed zip a run produces is never touched by this file — the AI's
 * generated HTML ships byte-for-byte (see `run.ts#assembleZip`). This exists
 * purely so the operator's in-app preview iframe (served from our own LMS
 * origin, not the eventual subdomain) can actually load a page's CSS/JS/
 * images: a template may reference its assets with a relative path
 * ("style.css"), a root-absolute one ("/style.css"), or a "./"-prefixed one —
 * all three resolve correctly once the site is deployed to its own domain
 * root, but none of them resolve correctly served from
 * `/api/site-builder/runs/{id}/preview`. Rewriting every attribute value that
 * names a known template asset file, regardless of which of those three forms
 * it used, is the smallest fix that covers all of them uniformly.
 *
 * Deliberately NOT a template compiler: no HTML parsing, no DOM, just a
 * regex over quoted `href=`/`src=` attribute values, matched against the
 * template's own already-known asset file list (see
 * `templates.ts#splitPagesAndAssets`). Anything that doesn't match an actual
 * asset file (an external CDN URL, an anchor `#section`, a `mailto:`/`tel:`
 * link) is left completely alone.
 */

const ATTR_RE = /(href|src)=(["'])([^"']+)\2/gi;

/** Strips a leading "./" or any number of leading "/" from a reference, and
 *  drops any query string or fragment — the same shape a caller would need
 *  to match one of `templates.ts`'s asset file entries (plain zip paths,
 *  never leading-slash, never query/fragment). */
function normalizeRef(value: string): string {
  const bare = value.split(/[?#]/)[0] ?? "";
  return bare.replace(/^(\.\/)+/, "").replace(/^\/+/, "");
}

export function rewriteAssetRefs(html: string, assetFiles: string[], previewAssetBase: string): string {
  if (assetFiles.length === 0) return html;
  const known = new Set(assetFiles);
  return html.replace(ATTR_RE, (whole, attr: string, quote: string, value: string) => {
    const normalized = normalizeRef(value);
    if (!known.has(normalized)) return whole;
    return `${attr}=${quote}${previewAssetBase}${encodeURIComponent(normalized)}${quote}`;
  });
}
