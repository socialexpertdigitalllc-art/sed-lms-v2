import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRenderedBox, placeKeyFromUrl } from '../core/collect-filter.js';

test('a laid-out node with an offset parent is rendered', () => {
  assert.equal(isRenderedBox({ width: 120, height: 90, hasOffsetParent: true }), true);
});

test('a zero-width node is not rendered', () => {
  assert.equal(isRenderedBox({ width: 0, height: 90, hasOffsetParent: true }), false);
});

test('a zero-height node is not rendered', () => {
  assert.equal(isRenderedBox({ width: 120, height: 0, hasOffsetParent: true }), false);
});

test('a detached / display:none node is not rendered', () => {
  assert.equal(isRenderedBox({ width: 120, height: 90, hasOffsetParent: false }), false);
});

test('reads the place key from a maps place url', () => {
  const u = 'https://www.google.com/maps/place/Joe+Plumbing/@40.7,-73.9,17z/data=!3m1!4b1!4m6';
  assert.equal(placeKeyFromUrl(u), 'Joe+Plumbing');
});

test('reads the place key from a data-only url', () => {
  const u = 'https://www.google.com/maps/place/data=!4m2!3m1!1s0x89c25a:0xabc';
  assert.equal(placeKeyFromUrl(u), 'data=!4m2!3m1!1s0x89c25a:0xabc');
});

test('returns null when there is no place segment', () => {
  assert.equal(placeKeyFromUrl('https://www.google.com/maps/@40.7,-73.9,12z'), null);
});
