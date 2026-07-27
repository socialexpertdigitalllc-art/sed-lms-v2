/**
 * Guards the caller-supplied `asset` query parameter on
 * `GET /runs/[id]/preview?asset=<path>` before it is used as a lookup key
 * into a render's FileMap (see `render/renderer.ts`'s `RenderResult.files`).
 *
 * A FileMap lookup by itself is already "safe" in the sense that an
 * unmatched key just 404s — nothing here ever touches a real filesystem.
 * This check exists anyway because that safety is an accident of the
 * current implementation, not a contract: this route takes an arbitrary
 * caller-supplied string and reads from storage, so the obvious attack
 * (path traversal, or smuggling an absolute/scheme-qualified reference past
 * whatever resolves this path next) must be refused explicitly, at the
 * boundary, rather than relying on "the lookup happens to fail closed."
 *
 * Rejects:
 *  - any path containing `..` (traversal, in either direction)
 *  - a leading `/` (absolute path)
 *  - a backslash (Windows-style separator, `..\..\`)
 *  - a scheme prefix (`file:`, `http:`, `javascript:`, …)
 *  - empty input
 *
 * Everything else — a plain relative path like `css/style.css` or
 * `img/a.jpg` — is accepted verbatim; this function does not resolve `.`/
 * normalize the path, it only refuses the dangerous shapes.
 */
export function isSafeAssetPath(path: string): boolean {
  if (!path) return false;
  if (path.includes("..")) return false;
  if (path.startsWith("/")) return false;
  if (path.includes("\\")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return false;
  return true;
}
