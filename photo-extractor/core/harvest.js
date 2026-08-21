// Pure session accumulator for a VIRTUALIZED gallery. No chrome/DOM deps —
// unit-testable under node --test.
//
// Why this exists: Google Maps unmounts photo tiles that scroll out of view,
// so any single DOM snapshot holds only what is on screen right now. Scrolling
// a 60-photo gallery and then reading the DOM yielded 3-4 photos — everything
// scrolled past was already gone. The scroll loop therefore folds each tick's
// snapshot in here and reads the UNION at the end.
//
// `scopeKey` guards the other half of that bug: Maps is an SPA, so one content
// script outlives navigation between businesses. A snapshot absorbed under a
// different key resets the session rather than mixing another business's
// photos into this lead's capture.

export const DEFAULT_MAX = 30;

export function createHarvester({ max = DEFAULT_MAX } = {}) {
  let seen = new Map(); // id -> url; insertion order = page order
  let key = null;

  return {
    /** Fold a snapshot (Map|iterable of [id, url]) in; returns the total. */
    absorb(snapshot, scopeKey = null) {
      if (scopeKey !== null && scopeKey !== key) {
        seen = new Map();
        key = scopeKey;
      }
      for (const [id, url] of snapshot ?? []) {
        if (id && url && !seen.has(id)) seen.set(id, url);
      }
      return seen.size;
    },
    reset(scopeKey = null) {
      seen = new Map();
      key = scopeKey;
    },
    /** Enough collected that scrolling further buys nothing. */
    isFull() {
      return seen.size >= max;
    },
    get size() {
      return seen.size;
    },
    get scopeKey() {
      return key;
    },
    entries() {
      return [...seen.entries()];
    },
  };
}
