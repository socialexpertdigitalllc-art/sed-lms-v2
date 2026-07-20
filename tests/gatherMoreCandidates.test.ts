/**
 * The page loop itself, with Pexels and Gemini stubbed out — no network, no
 * credits. Covers the behaviours the "No candidates" bug came down to: one
 * click walking several pages, the broader-query retry, and the budgets.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PexelsPhoto } from "@/lib/template-engine/pexels";
import type { VisionVerdict } from "@/lib/template-engine/imageSlots";
import type { ImageBrief } from "@/lib/template-engine/contentModel";
import type { SupabaseClient } from "@supabase/supabase-js";

const searchPexels = vi.fn();
const rankImages = vi.fn();

vi.mock("@/lib/template-engine/pexels", () => ({ searchPexels: (...a: unknown[]) => searchPexels(...a) }));
vi.mock("@/lib/template-engine/vision", () => ({ rankImages: (...a: unknown[]) => rankImages(...a) }));

const { gatherMoreCandidates } = await import("@/lib/template-engine/gatherImages");

const photo = (id: number): PexelsPhoto => ({
  id,
  width: 3000,
  height: 2000,
  alt: "a roof",
  photographer: "Jane",
  src: { original: `o${id}`, large2x: `l${id}`, large: `L${id}`, medium: `m${id}` },
});

const verdict = (people: boolean): VisionVerdict => ({ people, relevance: 0.9, quality: 0.9, reason: "ok" });

const brief: ImageBrief = {
  slot_id: "svc-soffit",
  kind: "service",
  query: "bespoke soffit repair",
  must_show: "",
  avoid: "people",
};

const admin = {} as SupabaseClient;
const base = { brief, businessType: "Roofing", admin, excludePeople: true, excludeIds: [], presentMax: 5, startPage: 2 };

beforeEach(() => {
  searchPexels.mockReset();
  rankImages.mockReset();
});

describe("gatherMoreCandidates", () => {
  it("walks more pages when a page is entirely filtered out, and stops once it has enough", async () => {
    let nextId = 1;
    searchPexels.mockImplementation(async () => Array.from({ length: 4 }, () => photo(nextId++)));
    // page 2 + its broadened retry: all people. page 3: all clean.
    rankImages
      .mockResolvedValueOnce([verdict(true), verdict(true), verdict(true), verdict(true)])
      .mockResolvedValueOnce([verdict(true), verdict(true), verdict(true), verdict(true)])
      .mockResolvedValue([verdict(false), verdict(false), verdict(false), verdict(false)]);

    const res = await gatherMoreCandidates(base);

    expect(res.candidates).toHaveLength(4);
    expect(res.stats.rejectedByVision).toBe(8);
    expect(res.stats.kept).toBe(4);
    expect(res.stats.pages).toBe(2); // page 2 (twice: specific + broad) and page 3
    expect(res.nextPage).toBe(4);
  });

  it("retries the SAME page with the broad businessType query when the specific one yields nothing", async () => {
    let nextId = 100;
    searchPexels.mockImplementation(async () => Array.from({ length: 3 }, () => photo(nextId++)));
    rankImages
      .mockResolvedValueOnce([verdict(true), verdict(true), verdict(true)]) // specific: all rejected
      .mockResolvedValue([verdict(false), verdict(false), verdict(false)]); // broad: clean

    const res = await gatherMoreCandidates(base);

    const queries = searchPexels.mock.calls.map((c) => c[0]);
    expect(queries[0]).toBe("bespoke soffit repair");
    expect(queries[1]).toBe("Roofing");
    const pages = searchPexels.mock.calls.map((c) => (c[4] as { page: number }).page);
    expect(pages[0]).toBe(2);
    expect(pages[1]).toBe(2); // same page, broader query
    expect(res.stats.broadened).toBe(true);
    // The broad retry's photos carry the query that actually found them, so the
    // UI can tell the operator these came from a wider search.
    expect(res.candidates.slice(0, 3).every((c) => c.query === "Roofing")).toBe(true);
  });

  it("never broadens when the brief query already IS the business type", async () => {
    searchPexels.mockResolvedValue([]);
    const res = await gatherMoreCandidates({
      ...base,
      brief: { ...brief, query: "roofing" },
      businessType: "Roofing",
    });
    expect(res.stats.broadened).toBe(false);
    expect(searchPexels).toHaveBeenCalledTimes(3); // one per page, no retries
  });

  it("stops at the page budget rather than looping forever on a dry query", async () => {
    searchPexels.mockResolvedValue([]);
    const res = await gatherMoreCandidates(base);
    expect(res.candidates).toHaveLength(0);
    expect(res.stats.pages).toBe(3);
    expect(res.nextPage).toBe(5); // pages 2,3,4 consumed
    expect(rankImages).not.toHaveBeenCalled(); // nothing fetched = no vision spend
  });

  it("honours the time budget: a slow first page ends the click", async () => {
    searchPexels.mockResolvedValue([]);
    let t = 0;
    const res = await gatherMoreCandidates({ ...base, now: () => (t += 20_000) });
    expect(res.stats.pages).toBe(1);
    expect(res.stats.timedOut).toBe(true);
  });

  it("records every fetched id as seen, not just the kept ones", async () => {
    searchPexels.mockResolvedValueOnce([photo(7), photo(8)]).mockResolvedValue([]);
    rankImages.mockResolvedValue([verdict(false), verdict(true)]);
    const res = await gatherMoreCandidates(base);
    expect(res.fetchedIds).toEqual(expect.arrayContaining([7, 8]));
  });

  it("does not re-report ids the slot had already seen", async () => {
    searchPexels.mockResolvedValueOnce([photo(7)]).mockResolvedValue([]);
    rankImages.mockResolvedValue([verdict(false)]);
    const res = await gatherMoreCandidates({ ...base, excludeIds: [7] });
    expect(res.fetchedIds).toEqual([]);
    expect(res.stats.alreadySeen).toBe(1);
  });
});
