import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normQuery,
  scorePhoto,
  pickBest,
  searchPexels,
  downloadImage,
  type PexelsPhoto,
  type ImageSlot,
} from "@/lib/template-engine/pexels";

const photo = (over: Partial<PexelsPhoto> = {}): PexelsPhoto => ({
  id: 1,
  width: 2000,
  height: 1250,
  alt: null,
  photographer: "Ann",
  src: { original: "o", large2x: "l2", large: "l", medium: "m" },
  ...over,
});

const slot = (over: Partial<ImageSlot> = {}): ImageSlot => ({
  key: "hero",
  query: "roof repair",
  altQueries: [],
  orientation: "landscape",
  minWidth: 1200,
  ...over,
});

describe("normQuery", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normQuery("  Roof   REPAIR  ")).toBe("roof repair");
  });
});

describe("scorePhoto", () => {
  const none = new Set<number>();

  it("scores pure rank decay as 15-index", () => {
    expect(scorePhoto(photo(), slot(), 0, none, null)).toBe(15);
    expect(scorePhoto(photo(), slot(), 5, none, null)).toBe(10);
  });

  it("kills photos below the slot minWidth", () => {
    expect(scorePhoto(photo({ width: 800, height: 500 }), slot(), 0, none, null)).toBe(-Infinity);
  });

  it("kills already-used photos", () => {
    expect(scorePhoto(photo(), slot(), 0, new Set([1]), null)).toBe(-Infinity);
  });

  it("penalizes wrong aspect for landscape slots (wants w/h >= 1.3)", () => {
    expect(scorePhoto(photo({ width: 1300, height: 1300 }), slot(), 0, none, null)).toBe(9);
  });

  it("penalizes wrong aspect for square slots (wants 0.7-1.4)", () => {
    const sq = slot({ orientation: "square", minWidth: 500 });
    expect(scorePhoto(photo({ width: 1000, height: 1000 }), sq, 0, none, null)).toBe(15);
    expect(scorePhoto(photo({ width: 2000, height: 900 }), sq, 0, none, null)).toBe(9);
  });

  it("adds +3 per query keyword-stem found in the alt", () => {
    expect(scorePhoto(photo({ alt: "Technician repairing a roof" }), slot(), 0, none, null)).toBe(21);
    expect(scorePhoto(photo({ alt: "a red roof" }), slot(), 0, none, null)).toBe(18);
  });

  it("adds +4 action bonus only when the slot wants action and the alt shows it", () => {
    const s = slot({ wantsAction: true });
    expect(scorePhoto(photo({ alt: "Technician repairing a roof" }), s, 0, none, null)).toBe(25);
    expect(scorePhoto(photo({ alt: "sunset over houses" }), s, 0, none, null)).toBe(15);
  });

  it("penalizes repeating the previous photographer by 3", () => {
    expect(scorePhoto(photo(), slot(), 0, none, "Ann")).toBe(12);
    expect(scorePhoto(photo(), slot(), 0, none, "Bob")).toBe(15);
  });
});

describe("pickBest", () => {
  it("prefers earlier rank when otherwise equal", () => {
    const a = photo({ id: 10 });
    const b = photo({ id: 11 });
    expect(pickBest([a, b], slot(), new Set(), null)?.id).toBe(10);
  });

  it("is deterministic on exact score ties (first wins)", () => {
    // a: index 0 but repeats the photographer -> 15 - 3 = 12
    // b: index 3 with a fresh photographer  -> 15 - 3 = 12
    const a = photo({ id: 20, photographer: "Ann" });
    const dead1 = photo({ id: 21, width: 100 });
    const dead2 = photo({ id: 22, width: 100 });
    const b = photo({ id: 23, photographer: "Bob" });
    expect(pickBest([a, dead1, dead2, b], slot(), new Set(), "Ann")?.id).toBe(20);
  });

  it("skips killed photos and returns null when none survive", () => {
    const used = photo({ id: 30 });
    const ok = photo({ id: 31 });
    expect(pickBest([used, ok], slot(), new Set([30]), null)?.id).toBe(31);
    expect(pickBest([photo({ id: 40, width: 10 })], slot(), new Set(), null)).toBeNull();
    expect(pickBest([], slot(), new Set(), null)).toBeNull();
  });
});

describe("searchPexels (network isolated)", () => {
  const savedKey = process.env.PEXELS_API_KEY;
  beforeEach(() => {
    process.env.PEXELS_API_KEY = "test-key";
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.PEXELS_API_KEY;
    else process.env.PEXELS_API_KEY = savedKey;
  });

  type CacheRow = { results: unknown; fetched_at: string } | null;
  const makeAdmin = (cached: CacheRow) => {
    const upserts: Record<string, unknown>[] = [];
    const eqArgs: unknown[] = [];
    const admin = {
      from: () => ({
        select: () => ({
          eq: (_col: string, val: unknown) => {
            eqArgs.push(val);
            return { maybeSingle: async () => ({ data: cached, error: null }) };
          },
        }),
        upsert: async (row: Record<string, unknown>) => {
          upserts.push(row);
          return { error: null };
        },
      }),
    };
    return { admin: admin as unknown as SupabaseClient, upserts, eqArgs };
  };

  const rawPhoto = {
    id: 7,
    width: 3000,
    height: 2000,
    alt: "roof work",
    photographer: "P",
    avg_color: "#aabbcc",
    src: { original: "o", large2x: "a", large: "b", medium: "c", small: "ignored" },
    url: "https://pexels.com/x",
  };

  it("returns fresh cached results without fetching", async () => {
    const cached = { results: [photo({ id: 99 })], fetched_at: new Date().toISOString() };
    const { admin } = makeAdmin(cached);
    const fetchImpl = vi.fn();
    const res = await searchPexels("Roof Repair", "landscape", admin, fetchImpl as unknown as typeof fetch);
    expect(res.map((p) => p.id)).toEqual([99]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches, maps, and upserts the cache on a stale/missing cache entry", async () => {
    const stale = { results: [photo({ id: 1 })], fetched_at: new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString() };
    const { admin, upserts } = makeAdmin(stale);
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ photos: [rawPhoto] }) };
    });
    const res = await searchPexels("Roof Repair", "landscape", admin, fetchImpl as unknown as typeof fetch);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ id: 7, width: 3000, height: 2000, alt: "roof work", photographer: "P" });
    expect(res[0].src).toEqual({ original: "o", large2x: "a", large: "b", medium: "c" });
    expect(calls[0].url).toContain("https://api.pexels.com/v1/search?");
    expect(calls[0].url).toContain("per_page=15");
    expect(calls[0].url).toContain("orientation=landscape");
    expect(calls[0].url).toContain(encodeURIComponent("roof repair"));
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("test-key");
    expect(upserts).toHaveLength(1);
    expect(String(upserts[0].query_norm)).toContain("roof repair");
  });

  it("threads page + perPage into the request URL and the cache key", async () => {
    const { admin, upserts } = makeAdmin(null);
    const calls: { url: string }[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push({ url });
      return { ok: true, json: async () => ({ photos: [rawPhoto] }) };
    });
    await searchPexels("Roof Repair", "landscape", admin, fetchImpl as unknown as typeof fetch, { page: 2, perPage: 24 });
    expect(calls[0].url).toContain("per_page=24");
    expect(calls[0].url).toContain("page=2");
    // Cache key carries perPage + page so page 2 never replays page 1's rows.
    expect(String(upserts[0].query_norm)).toBe("landscape:roof repair:24:2");
  });

  it("caps perPage at Pexels' max of 80", async () => {
    const { admin } = makeAdmin(null);
    const calls: { url: string }[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push({ url });
      return { ok: true, json: async () => ({ photos: [] }) };
    });
    await searchPexels("x", "square", admin, fetchImpl as unknown as typeof fetch, { perPage: 500 });
    expect(calls[0].url).toContain("per_page=80");
  });

  it("returns [] when fetch fails, the response is not ok, or the key is missing", async () => {
    const { admin } = makeAdmin(null);
    const boom = vi.fn(async () => {
      throw new Error("net down");
    });
    expect(await searchPexels("x", "square", admin, boom as unknown as typeof fetch)).toEqual([]);

    const notOk = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
    expect(await searchPexels("x", "square", admin, notOk as unknown as typeof fetch)).toEqual([]);

    delete process.env.PEXELS_API_KEY;
    const spy = vi.fn();
    expect(await searchPexels("x", "square", admin, spy as unknown as typeof fetch)).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("downloadImage (network isolated)", () => {
  it("returns bytes on success and null on failure", async () => {
    const okFetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }));
    const bytes = await downloadImage("https://img.example.com/a.jpg", okFetch as unknown as typeof fetch);
    expect(Array.from(bytes ?? [])).toEqual([1, 2, 3]);

    const notOk = vi.fn(async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) }));
    expect(await downloadImage("https://x", notOk as unknown as typeof fetch)).toBeNull();

    const boom = vi.fn(async () => {
      throw new Error("down");
    });
    expect(await downloadImage("https://x", boom as unknown as typeof fetch)).toBeNull();
  });
});
