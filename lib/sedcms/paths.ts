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
 *   - no dot-separated part after the first, in any segment and any case,
 *     names a server-side type (Apache's mod_mime honours every extension
 *     of a name, so "x.php.html" can run as PHP);
 *   - its first segment is not cgi-bin (anything there may run as CGI).
 */

export const CMS_EXTENSIONS: readonly string[] = ["html", "htm", "js", "css", "json", "xml", "txt", "webmanifest", "jpg", "jpeg", "png", "webp"];

/** The extensions whose text the live-files endpoint carries. */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set(["html", "htm", "js", "css", "json", "xml", "txt", "webmanifest"]);

const SERVER_SIDE: ReadonlySet<string> = new Set([
  "php", "php3", "php4", "php5", "php7", "php8", "phtml", "pht", "phar", "phps",
  "cgi", "fcgi", "pl", "py", "sh", "asp", "aspx", "jsp", "shtml", "shtm",
  "htaccess", "htpasswd", "ini",
]);

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
  for (const segment of segments) {
    if (!SEGMENT.test(segment) || segment.startsWith(".")) return false;
    const parts = segment.split(".");
    for (let i = 1; i < parts.length; i++) {
      if (SERVER_SIDE.has(parts[i].toLowerCase())) return false;
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
