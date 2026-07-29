import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPool, withRetry } from '../core/concurrency.js';

const tick = () => new Promise((r) => setTimeout(r, 1));

test('runPool respects the concurrency cap', async () => {
  let active = 0, maxActive = 0;
  const items = Array.from({ length: 20 }, (_, i) => i);
  await runPool(items, async () => {
    active++; maxActive = Math.max(maxActive, active);
    await tick();
    active--;
  }, { concurrency: 4 });
  assert.ok(maxActive <= 4, `maxActive ${maxActive} should be <= 4`);
});

test('runPool collects succeeded and failed without aborting on error', async () => {
  const items = [1, 2, 3, 4];
  const { succeeded, failed, total } = await runPool(items, async (n) => {
    if (n % 2 === 0) throw new Error('even ' + n);
    return n * 10;
  }, { concurrency: 2 });
  assert.equal(total, 4);
  assert.equal(succeeded.length, 2);
  assert.equal(failed.length, 2);
  assert.deepEqual(succeeded.map((s) => s.value).sort((a, b) => a - b), [10, 30]);
});

test('runPool stops dispatching when the signal is aborted', async () => {
  const ac = new AbortController();
  let started = 0;
  const items = Array.from({ length: 50 }, (_, i) => i);
  const p = runPool(items, async () => { started++; await tick(); }, { concurrency: 2, signal: ac.signal });
  setTimeout(() => ac.abort(), 3);
  await p;
  assert.ok(started < 50, `started ${started} should be < 50 after abort`);
});

test('withRetry succeeds after transient failures', async () => {
  let calls = 0;
  const value = await withRetry(async () => {
    calls++;
    if (calls < 3) throw new Error('flaky');
    return 'ok';
  }, { retries: 5, baseMs: 0, maxMs: 0 });
  assert.equal(value, 'ok');
  assert.equal(calls, 3);
});

test('withRetry gives up after the retry budget and respects isRetryable', async () => {
  let calls = 0;
  await assert.rejects(() => withRetry(async () => { calls++; throw new Error('boom'); },
    { retries: 2, baseMs: 0, maxMs: 0 }));
  assert.equal(calls, 3); // initial + 2 retries

  let calls2 = 0;
  await assert.rejects(() => withRetry(async () => { calls2++; throw new Error('fatal 404'); },
    { retries: 5, baseMs: 0, maxMs: 0, isRetryable: (e) => !/404/.test(e.message) }));
  assert.equal(calls2, 1); // not retried
});
