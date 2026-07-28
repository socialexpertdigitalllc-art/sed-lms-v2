// Pure helpers for scoping photo collection to the LIVE gallery.
// No DOM/chrome dependencies — unit-testable under node --test.
//
// WHY THIS EXISTS. Google Maps is a single-page app: navigating from one
// business to another never reloads the document, and Maps keeps the previous
// place card in the DOM (hidden) for back-navigation. A document-wide scan
// therefore picks up ~5-6 photos belonging to the business you just left.

/** True when a box is actually laid out on screen right now. */
export function isRenderedBox({ width, height, hasOffsetParent }) {
  return width > 0 && height > 0 && hasOffsetParent === true;
}

/**
 * Identifies which place a Maps URL is showing, so a change can reset state.
 * Returns null when the URL is not on a place (e.g. a bare map view).
 */
export function placeKeyFromUrl(href) {
  const m = String(href).match(/\/maps\/place\/([^/@?#]+)/);
  return m ? m[1] : null;
}
