import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRenderedBox } from '../core/collect-filter.js';

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
