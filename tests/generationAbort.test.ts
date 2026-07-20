import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AiCallAborted,
  combineAbortSignals,
  combineAbortSignalsManual,
  isAbortedError,
} from "@/lib/ai-tools/abort";
import {
  GenerationAbortReason,
  abortGeneration,
  clearAbortRegistry,
  haltModeOf,
  isGenerationRegistered,
  registerGeneration,
  registeredGenerationCount,
  unregisterGeneration,
} from "@/lib/template-engine/abortRegistry";

// The retry loops under test go through callForTask, so it is the single seam
// mocked here — the whole point is that a call which comes back ABORTED is not
// re-issued, no matter how many attempts the loop is configured for.
const callForTask = vi.fn();
vi.mock("@/lib/ai-tools/providers/run", () => ({
  callForTask: (...a: unknown[]) => callForTask(...a),
}));

const { regenerateFile } = await import("@/lib/template-engine/regenerate");
const { rankImages } = await import("@/lib/template-engine/vision");

beforeEach(() => {
  callForTask.mockReset();
  clearAbortRegistry();
});

describe("combined abort signals", () => {
  it("passes a single signal straight through, with nothing to clean up", () => {
    const c = new AbortController();
    const combined = combineAbortSignals([c.signal, undefined]);
    expect(combined.signal).toBe(c.signal);
    combined.cleanup(); // must not throw
  });

  it("returns a live signal when there is nothing to combine", () => {
    expect(combineAbortSignals([undefined, null]).signal.aborted).toBe(false);
  });

  it("fires when the FIRST of two signals aborts (timeout wins)", () => {
    const timeout = new AbortController();
    const external = new AbortController();
    const { signal } = combineAbortSignals([timeout.signal, external.signal]);
    expect(signal.aborted).toBe(false);
    timeout.abort(new Error("timed out"));
    expect(signal.aborted).toBe(true);
  });

  it("fires when the OTHER signal aborts first (stop wins), keeping the reason", () => {
    const timeout = new AbortController();
    const external = new AbortController();
    const { signal } = combineAbortSignals([timeout.signal, external.signal]);
    external.abort(new GenerationAbortReason("pause"));
    expect(signal.aborted).toBe(true);
    expect(haltModeOf(signal)).toBe("pause");
  });

  it("is already aborted when an input was aborted before combining", () => {
    const pre = new AbortController();
    pre.abort(new GenerationAbortReason("cancel"));
    const { signal } = combineAbortSignals([new AbortController().signal, pre.signal]);
    expect(signal.aborted).toBe(true);
    expect(haltModeOf(signal)).toBe("cancel");
  });

  describe("manual fallback (runtimes without AbortSignal.any)", () => {
    it("aborts on whichever input fires first and propagates the reason", () => {
      const a = new AbortController();
      const b = new AbortController();
      const { signal } = combineAbortSignalsManual([a.signal, b.signal]);
      b.abort(new GenerationAbortReason("pause"));
      expect(signal.aborted).toBe(true);
      expect(haltModeOf(signal)).toBe("pause");
    });

    it("short-circuits when an input is already aborted", () => {
      const a = new AbortController();
      a.abort(new Error("gone"));
      expect(combineAbortSignalsManual([a.signal, new AbortController().signal]).signal.aborted).toBe(true);
    });

    it("cleanup detaches the listeners so a long-lived signal does not leak them", () => {
      const external = new AbortController();
      const removed: unknown[] = [];
      const realRemove = external.signal.removeEventListener.bind(external.signal);
      external.signal.removeEventListener = ((...args: Parameters<typeof realRemove>) => {
        removed.push(args[0]);
        return realRemove(...args);
      }) as typeof realRemove;

      const combined = combineAbortSignalsManual([new AbortController().signal, external.signal]);
      combined.cleanup();
      expect(removed).toContain("abort");
      // And the detached combination no longer follows the external signal.
      external.abort(new GenerationAbortReason("cancel"));
      expect(combined.signal.aborted).toBe(false);
    });
  });
});

describe("isAbortedError", () => {
  it("recognises an external stop", () => {
    expect(isAbortedError(new AiCallAborted("Gemini"))).toBe(true);
  });
  it("recognises a raw DOM AbortError that never went through our wrapper", () => {
    const e = new Error("aborted");
    e.name = "AbortError";
    expect(isAbortedError(e)).toBe(true);
  });
  it("does NOT swallow the failures that SHOULD be retried", () => {
    expect(isAbortedError(new Error("fetch failed"))).toBe(false);
    expect(isAbortedError(new Error("Gemini call timed out after 300s"))).toBe(false);
    expect(isAbortedError(null)).toBe(false);
  });
});

describe("abort registry", () => {
  it("registers a controller a stop can reach, and aborts it with the right mode", () => {
    const controller = registerGeneration("gen-1");
    expect(isGenerationRegistered("gen-1")).toBe(true);
    expect(abortGeneration("gen-1", "pause")).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(haltModeOf(controller.signal)).toBe("pause");
  });

  it("reports false when no runner for that generation lives in this process", () => {
    expect(abortGeneration("nobody-home", "cancel")).toBe(false);
  });

  it("refuses to re-abort, so a second click cannot rewrite a pause as a cancel", () => {
    const controller = registerGeneration("gen-2");
    expect(abortGeneration("gen-2", "pause")).toBe(true);
    expect(abortGeneration("gen-2", "cancel")).toBe(false);
    expect(haltModeOf(controller.signal)).toBe("pause");
  });

  it("unregisters, leaving nothing behind", () => {
    const controller = registerGeneration("gen-3");
    unregisterGeneration("gen-3", controller);
    expect(isGenerationRegistered("gen-3")).toBe(false);
    expect(registeredGenerationCount()).toBe(0);
    expect(abortGeneration("gen-3", "cancel")).toBe(false);
  });

  it("an older runner unwinding must not evict a newer runner's entry", () => {
    const first = registerGeneration("gen-4");
    const second = registerGeneration("gen-4"); // a re-run claimed the slot
    unregisterGeneration("gen-4", first); // the old one finally finishes
    expect(isGenerationRegistered("gen-4")).toBe(true);
    expect(abortGeneration("gen-4", "cancel")).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(first.signal.aborted).toBe(false);
  });

  it("treats an abort with an unknown reason as a cancel, never a resumable pause", () => {
    const c = new AbortController();
    expect(haltModeOf(c.signal)).toBeNull();
    c.abort(new Error("something else killed it"));
    expect(haltModeOf(c.signal)).toBe("cancel");
  });
});

describe("retry loops never retry after an abort", () => {
  const regenArgs = { file: "index.html", source: "<html>a</html>", contentModel: {}, imagesForFile: [], demoTokens: [] };

  it("regenerateFile stops after ONE call when the run was aborted", async () => {
    const controller = new AbortController();
    callForTask.mockImplementation(async () => {
      controller.abort(new GenerationAbortReason("pause"));
      throw new AiCallAborted("Gemini", controller.signal.reason);
    });
    await expect(regenerateFile({ ...regenArgs, signal: controller.signal })).rejects.toBeInstanceOf(AiCallAborted);
    expect(callForTask).toHaveBeenCalledTimes(1);
  });

  it("regenerateFile still retries a genuine transient failure (3 attempts)", async () => {
    vi.useFakeTimers();
    callForTask.mockRejectedValue(new Error("fetch failed"));
    const p = regenerateFile(regenArgs);
    const assertion = expect(p).rejects.toThrow(/fetch failed/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(callForTask).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("regenerateFile does not even dial once the signal is already aborted mid-loop", async () => {
    const controller = new AbortController();
    callForTask.mockImplementation(async () => {
      controller.abort(new GenerationAbortReason("cancel"));
      throw new Error("fetch failed"); // looks transient, but the run is over
    });
    await expect(regenerateFile({ ...regenArgs, signal: controller.signal })).rejects.toThrow(/fetch failed/);
    expect(callForTask).toHaveBeenCalledTimes(1);
  });

  it("rankImages throws on abort instead of degrading to conservative verdicts", async () => {
    const controller = new AbortController();
    callForTask.mockImplementation(async () => {
      controller.abort(new GenerationAbortReason("cancel"));
      throw new AiCallAborted("Gemini", controller.signal.reason);
    });
    await expect(
      rankImages([{ url: "a" }, { url: "b" }], { query: "q", kind: "hero", businessType: "roofing" }, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(AiCallAborted);
    expect(callForTask).toHaveBeenCalledTimes(1); // not the second attempt
  });

  it("rankImages never buys a second chunk after a stop", async () => {
    const controller = new AbortController();
    controller.abort(new GenerationAbortReason("pause"));
    await expect(
      rankImages([{ url: "a" }], { query: "q", kind: "hero", businessType: "roofing" }, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(AiCallAborted);
    expect(callForTask).not.toHaveBeenCalled();
  });

  it("rankImages still absorbs a real provider outage as conservative verdicts", async () => {
    vi.useFakeTimers();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    callForTask.mockRejectedValue(new Error("429 rate limited"));
    const p = rankImages([{ url: "a" }], { query: "q", kind: "hero", businessType: "roofing" });
    await vi.runAllTimersAsync();
    const verdicts = await p;
    expect(verdicts).toEqual([{ people: true, relevance: 0, quality: 0, reason: "unreadable" }]);
    expect(callForTask).toHaveBeenCalledTimes(2);
    err.mockRestore();
    vi.useRealTimers();
  });
});

describe("control watcher", () => {
  it("fires once when the flag turns, then stops polling", async () => {
    vi.useFakeTimers();
    const { startControlWatcher } = await import("@/lib/template-engine/control");
    let control: string | null = null;
    const admin = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { control }, error: null }) }) }),
      }),
    } as never;

    const onHalt = vi.fn();
    const stop = startControlWatcher(admin, "gen-w", onHalt, 100);
    await vi.advanceTimersByTimeAsync(250);
    expect(onHalt).not.toHaveBeenCalled();

    control = "cancel";
    await vi.advanceTimersByTimeAsync(150);
    expect(onHalt).toHaveBeenCalledTimes(1);
    expect(onHalt).toHaveBeenCalledWith("cancel");

    await vi.advanceTimersByTimeAsync(500);
    expect(onHalt).toHaveBeenCalledTimes(1); // cleared itself
    stop();
    vi.useRealTimers();
  });

  it("stops polling the moment the runner releases it", async () => {
    vi.useFakeTimers();
    const { startControlWatcher } = await import("@/lib/template-engine/control");
    const maybeSingle = vi.fn(async () => ({ data: { control: null }, error: null }));
    const admin = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) } as never;

    const stop = startControlWatcher(admin, "gen-w2", vi.fn(), 100);
    await vi.advanceTimersByTimeAsync(250);
    const calls = maybeSingle.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(maybeSingle.mock.calls.length).toBe(calls);
    vi.useRealTimers();
  });
});

afterEach(() => {
  clearAbortRegistry();
  vi.useRealTimers();
});
