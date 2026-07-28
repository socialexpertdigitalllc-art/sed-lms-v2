import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSegment, pad, buildFilename } from '../core/naming.js';

test('pad zero-pads', () => {
  assert.equal(pad(1), '001');
  assert.equal(pad(42, 4), '0042');
});

test('sanitizeSegment strips illegal filename chars', () => {
  assert.equal(sanitizeSegment('Joe\'s / Bar: "Best"?'), "Joe's _ Bar_ _Best_");
  assert.equal(sanitizeSegment('  trailing.. '), 'trailing');
  assert.equal(sanitizeSegment(''), 'photo');
});

test('buildFilename default template makes a subfolder + padded index', () => {
  assert.equal(
    buildFilename('{business}/{business}_{index}', { business: "Joe's Diner", index: 3, ext: 'jpg' }),
    "Joe's Diner/Joe's Diner_003.jpg"
  );
});

test('buildFilename with date token', () => {
  assert.equal(
    buildFilename('{business}/{date}/{business}_{index}', { business: 'Cafe', index: 10, date: '2026-06-29', ext: 'jpg' }),
    'Cafe/2026-06-29/Cafe_010.jpg'
  );
});

test('buildFilename blocks path traversal in business name', () => {
  const out = buildFilename('{business}/{business}_{index}', { business: '../../etc', index: 1, ext: 'jpg' });
  assert.ok(!out.includes('..'));
});
