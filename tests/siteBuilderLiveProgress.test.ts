// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { recordOutput, liveSnapshot, clearLive } from "@/lib/site-builder/liveProgress";

/** The in-memory live-output registry (lib/site-builder/liveProgress.ts):
 *  accumulation, the ~2KB tail cap, per-run isolation, and clearing. */
describe("liveProgress registry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    // The registry is module-level state — every test leaves it empty.
    clearLive("run-a");
    clearLive("run-b");
    vi.useRealTimers();
  });

  it("accumulates chars and tail per file and stamps the last chunk's time", async () => {
    recordOutput("run-a", "index.html", "<html>");
    vi.setSystemTime(1_005_000);
    recordOutput("run-a", "index.html", "<body>hi</body></html>");
    recordOutput("run-a", "about.html", "<html>about");

    expect(liveSnapshot("run-a")).toEqual([
      // Sorted by file name, so the polled list never reorders between frames.
      { file: "about.html", chars: 11, lastChunkAt: 1_005_000, tail: "<html>about" },
      { file: "index.html", chars: 28, lastChunkAt: 1_005_000, tail: "<html><body>hi</body></html>" },
    ]);
  });

  it("caps the tail at 2048 chars while chars keeps counting the whole output", () => {
    recordOutput("run-a", "index.html", "A".repeat(2000));
    recordOutput("run-a", "index.html", "B".repeat(100));

    const [entry] = liveSnapshot("run-a");
    expect(entry.chars).toBe(2100);
    expect(entry.tail).toHaveLength(2048);
    // The LAST 2KB: the newest bytes survive, the oldest fall off the front.
    expect(entry.tail.endsWith("B".repeat(100))).toBe(true);
    expect(entry.tail.startsWith("A")).toBe(true);
  });

  it("isolates runs from each other, both in reads and in clears", () => {
    recordOutput("run-a", "index.html", "aaa");
    recordOutput("run-b", "index.html", "bbb");

    expect(liveSnapshot("run-a")[0].tail).toBe("aaa");
    expect(liveSnapshot("run-b")[0].tail).toBe("bbb");

    clearLive("run-a");
    expect(liveSnapshot("run-a")).toEqual([]);
    expect(liveSnapshot("run-b")[0].tail).toBe("bbb");
  });

  it("ignores an empty delta — no fake liveness stamp, no phantom file", () => {
    recordOutput("run-a", "index.html", "");
    expect(liveSnapshot("run-a")).toEqual([]);
  });

  it("an unknown run snapshots to an empty list, and clearing it is a no-op", () => {
    expect(liveSnapshot("run-a")).toEqual([]);
    expect(() => clearLive("run-a")).not.toThrow();
  });
});
