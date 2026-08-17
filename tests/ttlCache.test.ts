import { describe, it, expect, vi, beforeEach } from "vitest";
import { ttlCached, ttlGateOpen, ttlInvalidate, ttlResetAll } from "@/lib/cache/ttl";

/** The disk-IO fix's cache primitive: staleness bounded by TTL, bursts
 *  collapsed by inflight dedup, writes able to invalidate. */

beforeEach(() => {
  ttlResetAll();
});

describe("ttlCached", () => {
  it("computes once within the TTL and recomputes after expiry", async () => {
    let t = 1_000;
    const now = () => t;
    const compute = vi.fn(async () => "v" + t);

    expect(await ttlCached("s", "k", 30_000, compute, now)).toBe("v1000");
    t = 20_000;
    expect(await ttlCached("s", "k", 30_000, compute, now)).toBe("v1000");
    expect(compute).toHaveBeenCalledTimes(1);

    t = 40_000; // 1000 + 30000 < 40000 → expired
    expect(await ttlCached("s", "k", 30_000, compute, now)).toBe("v40000");
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent callers into one compute", async () => {
    let release!: (v: string) => void;
    const compute = vi.fn(() => new Promise<string>((r) => (release = r)));

    const a = ttlCached("s", "k", 30_000, compute);
    const b = ttlCached("s", "k", 30_000, compute);
    release("shared");
    expect(await a).toBe("shared");
    expect(await b).toBe("shared");
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed compute", async () => {
    const compute = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce("recovered");

    await expect(ttlCached("s", "k", 30_000, compute)).rejects.toThrow("db down");
    expect(await ttlCached("s", "k", 30_000, compute)).toBe("recovered");
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("keys stores and entries independently, and invalidates by key or store", async () => {
    const t = 0;
    const now = () => t;
    const compute = vi.fn(async () => "x");
    await ttlCached("a", "k1", 60_000, compute, now);
    await ttlCached("a", "k2", 60_000, compute, now);
    await ttlCached("b", "k1", 60_000, compute, now);
    expect(compute).toHaveBeenCalledTimes(3);

    ttlInvalidate("a", "k1");
    await ttlCached("a", "k1", 60_000, compute, now); // recomputed
    await ttlCached("a", "k2", 60_000, compute, now); // still cached
    expect(compute).toHaveBeenCalledTimes(4);

    ttlInvalidate("a");
    await ttlCached("a", "k2", 60_000, compute, now); // whole store dropped
    expect(compute).toHaveBeenCalledTimes(5);
  });
});

describe("ttlGateOpen", () => {
  it("opens on first call, stays shut within the interval, reopens after", () => {
    let t = 0;
    const now = () => t;
    expect(ttlGateOpen("g", "housekeeping", 6 * 3_600_000, now)).toBe(true);
    t = 3 * 3_600_000;
    expect(ttlGateOpen("g", "housekeeping", 6 * 3_600_000, now)).toBe(false);
    t = 7 * 3_600_000;
    expect(ttlGateOpen("g", "housekeeping", 6 * 3_600_000, now)).toBe(true);
  });
});
