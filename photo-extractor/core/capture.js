// Pure: turn harvested adapter items into the shape the LMS stores.
// No chrome/DOM dependencies — unit-testable under node --test.
import { isGooglePhotoUrl } from './url-tools.js';

export const MAX_PHOTOS = 30;

/**
 * Normalise, de-duplicate and cap a harvest.
 *
 * Only Google photo URLs survive: the LMS server (and imgbb) will fetch
 * `sourceUrl` later, so letting an arbitrary URL through here would hand a
 * server-side fetch to whatever was on the page.
 */
export function toWirePhotos(items, max = MAX_PHOTOS) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (out.length >= max) break;
    if (!it || seen.has(it.id)) continue;
    if (!isGooglePhotoUrl(it.thumbUrl) || !isGooglePhotoUrl(it.originalUrl)) continue;
    seen.add(it.id);
    out.push({ key: it.id, thumbUrl: it.thumbUrl, sourceUrl: it.originalUrl });
  }
  return out;
}
