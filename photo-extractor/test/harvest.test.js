import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarvester, DEFAULT_MAX } from '../core/harvest.js';

// The bug this exists to prevent: Google Maps unmounts photo tiles that
// scroll out of view, so reading the DOM after a scroll returned 3-4 photos
// instead of the ~30 the gallery actually held.
test('accumulates across snapshots that no longer overlap', () => {
  const h = createHarvester();
  h.absorb([['a', 'ua'], ['b', 'ub']], 'place-1');   // tiles 1-2 on screen
  h.absorb([['c', 'uc'], ['d', 'ud']], 'place-1');   // scrolled: 1-2 unmounted
  h.absorb([['e', 'ue']], 'place-1');
  assert.equal(h.size, 5);
  assert.deepEqual(h.entries().map(([id]) => id), ['a', 'b', 'c', 'd', 'e']);
});

test('keeps page order and ignores repeats', () => {
  const h = createHarvester();
  h.absorb([['a', 'ua'], ['b', 'ub']], 'p');
  h.absorb([['b', 'ub-again'], ['a', 'ua-again']], 'p');
  assert.equal(h.size, 2);
  assert.equal(h.entries()[0][1], 'ua', 'first URL seen for an id wins');
});

test('a different business resets the session — never mix two leads', () => {
  const h = createHarvester();
  h.absorb([['a', 'ua']], 'acme-plumbing');
  h.absorb([['z', 'uz']], 'best-roofing');
  assert.equal(h.size, 1);
  assert.deepEqual(h.entries().map(([id]) => id), ['z']);
});

test('isFull reports when scrolling further buys nothing', () => {
  const h = createHarvester({ max: 3 });
  h.absorb([['a', 'u'], ['b', 'u']], 'p');
  assert.equal(h.isFull(), false);
  h.absorb([['c', 'u']], 'p');
  assert.equal(h.isFull(), true);
  assert.equal(DEFAULT_MAX, 30);
});

test('tolerates empty and malformed snapshots', () => {
  const h = createHarvester();
  h.absorb(null, 'p');
  h.absorb([], 'p');
  h.absorb([[null, 'u'], ['x', null], ['ok', 'uok']], 'p');
  assert.equal(h.size, 1);
});
