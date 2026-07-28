// Pure URL helpers. No chrome/DOM dependencies — unit-testable under node --test.

const GOOGLE_HOST_RE = /^https?:\/\/[a-z0-9-]+\.googleusercontent\.com\//i;
const GOOGLE_TOKEN_RE = /\/(?:p|gps-cs-s)\/([^=/?#]+)/;
const YELP_ANY_RE = /yelpcdn\.com\/bphoto\//i;
const YELP_ID_RE = /\/bphoto\/([A-Za-z0-9_-]+)\//;

export function isValidHttpUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isGooglePhotoUrl(u) {
  return typeof u === 'string' && GOOGLE_HOST_RE.test(u) && GOOGLE_TOKEN_RE.test(u);
}

export function isYelpPhotoUrl(u) {
  return typeof u === 'string' && YELP_ANY_RE.test(u);
}

export function parseGooglePhotoId(u) {
  const m = String(u).match(GOOGLE_TOKEN_RE);
  return m ? m[1] : null;
}

export function parseYelpPhotoId(u) {
  const m = String(u).match(YELP_ID_RE);
  return m ? m[1] : null;
}

// Rewrite the size suffix (everything after the final '=' that follows the last '/').
export function toGoogleSize(u, size = 's0') {
  const eq = u.lastIndexOf('=');
  const slash = u.lastIndexOf('/');
  return eq > slash ? u.slice(0, eq + 1) + size : u + '=' + size;
}

export function toOriginalGoogle(u) {
  return toGoogleSize(u, 's0');
}

export function toOriginalYelp(u) {
  return u.replace(/(\/bphoto\/[A-Za-z0-9_-]+\/)[^/?#]+\.(?:jpe?g|png|webp)/i, '$1o.jpg');
}

// Scan rendered HTML for all Yelp bphoto ids (catches <img>, srcset, and embedded JSON).
// Host is matched broadly (any *.yelpcdn.com) so a CDN host change doesn't break it.
export function findYelpPhotoUrls(html) {
  const re = /(?:https?:)?\/\/((?:[a-z0-9-]+\.)*yelpcdn\.com)\/bphoto\/([A-Za-z0-9_-]+)\//g;
  const byId = new Map();
  let m;
  while ((m = re.exec(html)) !== null) {
    const [, host, id] = m;
    if (!byId.has(id)) byId.set(id, `https://${host}/bphoto/${id}/o.jpg`);
  }
  return [...byId.entries()].map(([id, url]) => ({ id, url }));
}
