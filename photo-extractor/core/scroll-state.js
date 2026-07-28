// Pure stop-condition state machine for auto-scrolling a lazy/virtualized gallery.

export function createScrollMonitor({ stallLimit = 3, maxIterations = 500 } = {}) {
  let lastHeight = -1;
  let lastCount = -1;
  let stall = 0;
  let iterations = 0;

  return {
    observe({ scrollHeight = 0, count = 0, atBottom = false }) {
      iterations++;
      const grew = scrollHeight > lastHeight || count > lastCount;
      stall = grew ? 0 : stall + 1;
      lastHeight = Math.max(lastHeight, scrollHeight);
      lastCount = Math.max(lastCount, count);

      if (iterations >= maxIterations) return { stop: true, reason: 'max-iterations' };
      if (stall >= stallLimit && atBottom) return { stop: true, reason: 'stable' };
      if (stall >= stallLimit + 2) return { stop: true, reason: 'stable-no-bottom' };
      return { stop: false, reason: null };
    },
    get iterations() { return iterations; },
    get count() { return lastCount; },
  };
}
