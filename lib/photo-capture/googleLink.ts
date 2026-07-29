/**
 * Google's own hostnames, anchored at BOTH ends. Anchoring only the start —
 * /^(www\.)?google\./ — accepts google.com.evil.com, because that string does
 * begin with "google.". The shape here accepts any 2-3 letter TLD, optionally
 * followed by a 2-letter second-level domain: google.com, google.de,
 * google.co.uk, google.com.au. It rejects google.attacker.tld and
 * google.com.evil.com, whose extra labels are too long to be a TLD.
 */
const GOOGLE_HOST_RE = /^(?:www\.|maps\.)?google\.[a-z]{2,3}(?:\.[a-z]{2})?$/;

/**
 * Does `business_profile_link` point at a Google Business Profile?
 *
 * Only these trigger a capture. A Yelp link is deliberately NOT accepted: the
 * extension has a working Yelp adapter, but Yelp capture is out of scope
 * (see the design, §16) and silently half-supporting it would confuse.
 */
export function isGoogleProfileLink(link: string | null | undefined): boolean {
  const raw = (link ?? "").trim();
  if (!raw) return false;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;

  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  // Short links resolve to a place; the extension follows the redirect.
  if (host === "maps.app.goo.gl" || host === "goo.gl" || host === "g.page") return true;

  if (!GOOGLE_HOST_RE.test(host)) return false;
  // maps.google.<tld> is a Maps host whatever the path.
  if (host.startsWith("maps.")) return true;
  // On www.google.<tld> only the /maps path is a profile link. Segment match,
  // NOT a prefix match — startsWith("/maps") would also accept /mapsfoo.
  return path === "/maps" || path.startsWith("/maps/");
}

/**
 * Google's photo CDN, anchored at the start of the string with a trailing
 * `/` so the host cannot be followed by anything but a path — a bare
 * `.../\.googleusercontent\.com/i` WITHOUT that trailing slash would still
 * need the scheme+host to open the string, but the slash is what stops a
 * hostname like `googleusercontent.com.evil.com` (no slash right after
 * `.com`) from slipping through.
 *
 * A candidate's `sourceUrl`/`thumbUrl` is written once by the candidates
 * route and later handed straight to `fetch()` (bytes for postimages and
 * imgchest) and to imgbb (which fetches server-side from whatever URL we
 * hand it) — anything other than Google's own CDN here is an SSRF, so both
 * the write path and every later read of a stored URL must check this.
 */
const GOOGLE_PHOTO_SOURCE_RE = /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//i;

/** Is `url` a googleusercontent.com photo URL? */
export function isGooglePhotoSourceUrl(url: string): boolean {
  return GOOGLE_PHOTO_SOURCE_RE.test(url);
}
