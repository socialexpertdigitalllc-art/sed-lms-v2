/**
 * The file paths SED CMS may read and write in a client site's docroot.
 * SERVER ONLY. The same rules, with the same test vectors
 * (tests/fixtures/sedcms/shared-vectors.json), as the CMS's own
 * @sedcms/static safePath: a path either side refuses is never sent and never
 * written.
 *
 * A path is allowed only when all of these hold:
 *   - it is relative and made of segments of [A-Za-z0-9._-] joined by "/":
 *     no leading or trailing slash, no empty segment, and nothing else at all
 *     (no backslash, percent, colon, space, control or non-ASCII character),
 *     so there is nothing to decode and no second meaning;
 *   - no segment is "." or "..", and none starts with "." (no .htaccess,
 *     no .well-known, no hidden files);
 *   - at most 300 characters and 6 segments;
 *   - its last extension, lowercase as written, is one of CMS_EXTENSIONS;
 *   - in every segment, each dot-separated part after the first is "min" or
 *     digits only, except the file name's last part (its extension): an
 *     allowlist, because Apache's mod_mime honours every extension of a
 *     name ("x.php.html" can run as PHP, "x.asis.html" sends its own
 *     headers) and no list of the handlers a server knows is complete;
 *   - its first segment is not cgi-bin (anything there may run as CGI).
 */

export const CMS_EXTENSIONS: readonly string[] = ["html", "htm", "js", "css", "json", "xml", "txt", "webmanifest", "jpg", "jpeg", "png", "webp"];

/** The extensions whose text the live-files endpoint carries. */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set(["html", "htm", "js", "css", "json", "xml", "txt", "webmanifest"]);

/** What a name may have between its first part and its extension: app.min.js, jquery-3.7.1.min.js. */
const MIDDLE_PART = /^(min|[0-9]+)$/;

export const MAX_PATH_LENGTH = 300;
export const MAX_PATH_SEGMENTS = 6;
/** The largest file the CMS may write (and the largest it ever expects to find). */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

const SEGMENT = /^[A-Za-z0-9._-]+$/;

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : null;
}

export function cmsPathAllowed(path: unknown): path is string {
  if (typeof path !== "string" || path.length === 0 || path.length > MAX_PATH_LENGTH) return false;
  const segments = path.split("/");
  if (segments.length > MAX_PATH_SEGMENTS) return false;
  for (const [index, segment] of segments.entries()) {
    if (!SEGMENT.test(segment) || segment.startsWith(".")) return false;
    const parts = segment.split(".");
    // a folder's every part after the first; a file's, but its extension
    const end = index === segments.length - 1 ? parts.length - 1 : parts.length;
    for (let i = 1; i < end; i++) {
      if (!MIDDLE_PART.test(parts[i])) return false;
    }
  }
  if (segments[0].toLowerCase() === "cgi-bin") return false;
  const ext = extensionOf(segments[segments.length - 1]);
  return ext !== null && CMS_EXTENSIONS.includes(ext);
}

/** True for a path whose extension is one live-files carries the text of. */
export function isTextPath(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const ext = extensionOf(name);
  return ext !== null && TEXT_EXTENSIONS.has(ext);
}
