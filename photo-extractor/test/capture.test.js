import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toWirePhotos, MAX_PHOTOS } from '../core/capture.js';

const item = (id) => ({
  id,
  thumbUrl: `https://lh3.googleusercontent.com/p/${id}=w408-h306-k-no`,
  originalUrl: `https://lh3.googleusercontent.com/p/${id}=s0`,
  site: 'google-maps',
});

test('caps the harvest at 30', () => {
  assert.equal(MAX_PHOTOS, 30);
  const many = Array.from({ length: 45 }, (_, i) => item('ID' + i));
  assert.equal(toWirePhotos(many).length, 30);
});

test('maps to the wire shape', () => {
  assert.deepEqual(toWirePhotos([item('ABC')]), [{
    key: 'ABC',
    thumbUrl: 'https://lh3.googleusercontent.com/p/ABC=w408-h306-k-no',
    sourceUrl: 'https://lh3.googleusercontent.com/p/ABC=s0',
  }]);
});

test('drops anything that is not a google photo', () => {
  const bad = { id: 'x', thumbUrl: 'https://evil.example/a.jpg', originalUrl: 'https://evil.example/a.jpg', site: 'generic' };
  assert.deepEqual(toWirePhotos([bad]), []);
});

test('drops duplicates by id, keeping the first', () => {
  assert.equal(toWirePhotos([item('SAME'), item('SAME')]).length, 1);
});

test('handles an empty harvest', () => {
  assert.deepEqual(toWirePhotos([]), []);
});
