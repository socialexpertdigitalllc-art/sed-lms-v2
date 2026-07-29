import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadByUrl, uploadByBase64, isBadKeyError } from '../core/imgbb.js';

function stubFetch(handler) {
  const orig = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = orig; };
}

test('uploadByUrl puts key in query + image/name in form, returns direct url', async () => {
  let captured;
  const restore = stubFetch(async (url, opts) => {
    captured = { url: String(url), opts };
    return new Response(JSON.stringify({
      success: true, status: 200,
      data: { url: 'https://i.ibb.co/x/a.jpg', display_url: 'https://i.ibb.co/x/a.jpg', delete_url: 'https://ibb.co/d/abc', id: 'abc' },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  try {
    const res = await uploadByUrl('KEY123', 'https://example.com/p.jpg', 'biz_001');
    assert.equal(res.url, 'https://i.ibb.co/x/a.jpg');
    assert.equal(res.deleteUrl, 'https://ibb.co/d/abc');
    assert.match(captured.url, /key=KEY123/);
    assert.equal(captured.opts.method, 'POST');
    assert.equal(captured.opts.body.get('image'), 'https://example.com/p.jpg');
    assert.equal(captured.opts.body.get('name'), 'biz_001');
  } finally { restore(); }
});

test('throws on imgbb error response', async () => {
  const restore = stubFetch(async () => new Response(
    JSON.stringify({ success: false, error: { message: 'Invalid API v1 key' }, status_txt: 'Bad Request' }),
    { status: 400, headers: { 'content-type': 'application/json' } }
  ));
  try {
    await assert.rejects(() => uploadByUrl('bad', 'u', 'n'), /Invalid API/);
  } finally { restore(); }
});

test('uploadByBase64 strips the data: prefix', async () => {
  let body;
  const restore = stubFetch(async (url, opts) => {
    body = opts.body;
    return new Response(JSON.stringify({ success: true, data: { url: 'u' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  try {
    await uploadByBase64('K', 'data:image/jpeg;base64,QUJD', 'n');
    assert.equal(body.get('image'), 'QUJD');
  } finally { restore(); }
});

test('isBadKeyError detects key problems but not transient errors', () => {
  assert.equal(isBadKeyError(new Error('Invalid API key')), true);
  assert.equal(isBadKeyError(new Error('network timeout')), false);
});
