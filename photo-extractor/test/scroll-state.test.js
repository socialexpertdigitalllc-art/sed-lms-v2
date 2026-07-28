import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScrollMonitor } from '../core/scroll-state.js';

test('does not stop while content keeps growing', () => {
  const m = createScrollMonitor({ stallLimit: 3, maxIterations: 100 });
  for (let i = 1; i <= 10; i++) {
    const r = m.observe({ scrollHeight: i * 1000, count: i * 12, atBottom: false });
    assert.equal(r.stop, false);
  }
});

test('stops after stallLimit when at bottom and nothing new loads', () => {
  const m = createScrollMonitor({ stallLimit: 3, maxIterations: 100 });
  m.observe({ scrollHeight: 5000, count: 60, atBottom: true });
  assert.equal(m.observe({ scrollHeight: 5000, count: 60, atBottom: true }).stop, false);
  assert.equal(m.observe({ scrollHeight: 5000, count: 60, atBottom: true }).stop, false);
  const r = m.observe({ scrollHeight: 5000, count: 60, atBottom: true });
  assert.equal(r.stop, true);
  assert.equal(r.reason, 'stable');
});

test('hard cap stops the loop regardless', () => {
  const m = createScrollMonitor({ stallLimit: 100, maxIterations: 5 });
  let last;
  for (let i = 0; i < 5; i++) last = m.observe({ scrollHeight: i * 10, count: i, atBottom: false });
  assert.equal(last.stop, true);
  assert.equal(last.reason, 'max-iterations');
});
