// Pure async control-flow helpers. No chrome/DOM dependencies.

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
    }
  });
}

export async function runPool(items, taskFn, { concurrency = 6, signal } = {}) {
  const list = Array.from(items);
  const results = new Array(list.length);
  const succeeded = [];
  const failed = [];
  let next = 0;

  async function worker() {
    for (;;) {
      if (signal?.aborted) return;
      const i = next++;
      if (i >= list.length) return;
      try {
        const value = await taskFn(list[i], i, signal);
        results[i] = { ok: true, value };
        succeeded.push({ index: i, item: list[i], value });
      } catch (err) {
        const reason = String(err?.message || err);
        results[i] = { ok: false, error: err };
        failed.push({ index: i, item: list[i], reason });
      }
    }
  }

  const n = Math.max(1, Math.min(concurrency, list.length || 1));
  await Promise.all(Array.from({ length: n }, worker));
  return { results, succeeded, failed, total: list.length };
}

export async function withRetry(fn, {
  retries = 3, baseMs = 500, maxMs = 8000, signal,
  rand = Math.random, isRetryable = () => true,
} = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (signal?.aborted) throw err;
      if (attempt >= retries || !isRetryable(err)) throw err;
      const backoff = Math.min(maxMs, baseMs * 2 ** attempt);
      const jitter = backoff * 0.5 * rand();
      if (backoff + jitter > 0) await sleep(backoff + jitter, signal);
      attempt++;
    }
  }
}
