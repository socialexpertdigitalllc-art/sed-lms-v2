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
  // maps.google.com / maps.google.co.uk / ...
  if (/^maps\.google\./.test(host)) return true;
  // www.google.<tld>/maps/...
  // Segment match, NOT a prefix match: `startsWith("/maps")` would also accept
  // /mapsfoo and friends. This gates a URL we later open in the operator's
  // browser, so err toward rejecting — a real-but-unusual Google URL just
  // means the operator captures manually.
  if (/^(www\.)?google\./.test(host) && (path === "/maps" || path.startsWith("/maps/"))) return true;

  return false;
}
