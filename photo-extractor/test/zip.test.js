import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZipBlob } from '../core/zip.js';

test('buildZipBlob produces a valid zip (PK signature) from entries', async () => {
  const blob = await buildZipBlob([
    { name: 'a.txt', input: 'hello' },
    { name: 'b.txt', input: new TextEncoder().encode('world') },
  ]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // ZIP local file header magic: 0x50 0x4B 0x03 0x04 ("PK..")
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.ok(bytes.length > 0);
});
