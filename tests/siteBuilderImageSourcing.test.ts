// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { sourceImagesForNeeds } from "@/lib/site-builder/imageSourcing";
import type { ImageNeed } from "@/lib/site-builder/imageNeeds";
import type { AssetRow } from "@/lib/site-studio/assets/types";
import type { PexelsResult } from "@/lib/site-studio/assets/pexels";

const searchLibraryMock = vi.fn();
vi.mock("@/lib/site-studio/assets/library", () => ({
  searchLibrary: (...args: unknown[]) => searchLibraryMock(...args),
}));

function libraryRow(id: string, overrides: Partial<AssetRow> = {}): AssetRow {
  return {
    id,
    kind: "stock",
    lead_id: null,
    subject: "plumber",
    niche_tags: [],
    width: 1600,
    height: 1200,
    source: "pexels",
    pexels_id: null,
    photographer: null,
    storage_path: `${id}.jpg`,
    content_type: "image/jpeg",
    use_count: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function pexelsCandidate(id: number, overrides: Partial<Extract<PexelsResult, { ok: true }>["candidates"][number]> = {}) {
  return {
    kind: "pexels" as const,
    pexels_id: id,
    thumb_url: `https://images.pexels.com/${id}-thumb.jpg`,
    download_url: `https://images.pexels.com/${id}-full.jpg`,
    width: 1600,
    height: 1200,
    photographer: "Jane Doe",
    ...overrides,
  };
}

const needs: ImageNeed[] = [
  { purpose: "Hero", query: "plumbing" },
  { purpose: "Service: Drain Cleaning", query: "drain cleaning plumbing" },
];

const admin = {} as never; // never touched directly — only passed through to the mocked searchLibrary

describe("sourceImagesForNeeds", () => {
  it("returns library candidates without calling Pexels once the top-up threshold is met", async () => {
    searchLibraryMock.mockResolvedValue([libraryRow("a"), libraryRow("b"), libraryRow("c"), libraryRow("d")]);
    const searchPexels = vi.fn();
    const result = await sourceImagesForNeeds({ admin, searchPexels }, [needs[0]], "lead-1");
    expect(searchPexels).not.toHaveBeenCalled();
    expect(result[0].candidates).toHaveLength(4);
    expect(result[0].candidates.every((c) => c.kind === "library")).toBe(true);
    expect(result[0].pexelsError).toBeNull();
  });

  it("tops up with Pexels when the library falls short of the threshold", async () => {
    searchLibraryMock.mockResolvedValue([libraryRow("a")]);
    const searchPexels = vi.fn(async (): Promise<PexelsResult> => ({
      ok: true,
      candidates: [pexelsCandidate(1), pexelsCandidate(2)],
    }));
    const result = await sourceImagesForNeeds({ admin, searchPexels }, [needs[0]], "lead-1");
    expect(searchPexels).toHaveBeenCalledWith("plumbing");
    expect(result[0].candidates.map((c) => c.kind)).toEqual(["library", "pexels", "pexels"]);
  });

  it("filters out undersized Pexels results", async () => {
    searchLibraryMock.mockResolvedValue([]);
    const searchPexels = vi.fn(async (): Promise<PexelsResult> => ({
      ok: true,
      candidates: [pexelsCandidate(1, { width: 400, height: 300 }), pexelsCandidate(2)],
    }));
    const result = await sourceImagesForNeeds({ admin, searchPexels }, [needs[0]], "lead-1");
    expect(result[0].candidates).toHaveLength(1);
    expect(result[0].candidates[0]).toMatchObject({ kind: "pexels", pexels_id: 2 });
  });

  it("a Pexels failure for one need degrades that need only, never throws", async () => {
    searchLibraryMock.mockResolvedValue([]);
    const searchPexels = vi.fn(async (query: string): Promise<PexelsResult> => {
      if (query === "plumbing") return { ok: false, error: "pexels HTTP 500" };
      return { ok: true, candidates: [pexelsCandidate(9)] };
    });
    const result = await sourceImagesForNeeds({ admin, searchPexels }, needs, "lead-1");
    expect(result[0].purpose).toBe("Hero");
    expect(result[0].candidates).toEqual([]);
    expect(result[0].pexelsError).toBe("pexels HTTP 500");
    expect(result[1].purpose).toBe("Service: Drain Cleaning");
    expect(result[1].candidates).toHaveLength(1);
    expect(result[1].pexelsError).toBeNull();
  });

  it("a library search throwing degrades to zero library candidates, not a thrown error", async () => {
    searchLibraryMock.mockRejectedValue(new Error("db down"));
    const searchPexels = vi.fn(async (): Promise<PexelsResult> => ({ ok: true, candidates: [pexelsCandidate(1)] }));
    const result = await sourceImagesForNeeds({ admin, searchPexels }, [needs[0]], "lead-1");
    expect(result[0].candidates).toHaveLength(1);
    expect(result[0].candidates[0].kind).toBe("pexels");
  });

  it("dedupes candidates globally across needs — the same photo never appears twice", async () => {
    searchLibraryMock.mockImplementation(async (_admin: unknown, opts: { subject?: string }) => {
      // Same library row surfaces for both needs' subject searches.
      return [libraryRow("shared"), libraryRow("shared")]; // even duplicated within one call, dedupe still applies
    });
    const searchPexels = vi.fn(async (): Promise<PexelsResult> => ({ ok: true, candidates: [] }));
    const result = await sourceImagesForNeeds({ admin, searchPexels }, needs, "lead-1");
    expect(result[0].candidates.map((c) => c.kind === "library" && c.asset_id)).toEqual(["shared"]);
    // Second need's search returns the same row again — already used, so it's excluded.
    expect(result[1].candidates).toEqual([]);
  });

  it("dedupes Pexels ids globally across needs", async () => {
    searchLibraryMock.mockResolvedValue([]);
    const searchPexels = vi.fn(async (): Promise<PexelsResult> => ({ ok: true, candidates: [pexelsCandidate(42)] }));
    const result = await sourceImagesForNeeds({ admin, searchPexels }, needs, "lead-1");
    expect(result[0].candidates).toHaveLength(1);
    expect(result[1].candidates).toEqual([]); // same pexels_id 42 already used by Hero
  });

  it("skips the Pexels call entirely for a need with an empty query", async () => {
    searchLibraryMock.mockResolvedValue([]);
    const searchPexels = vi.fn();
    const result = await sourceImagesForNeeds({ admin, searchPexels }, [{ purpose: "Hero", query: "" }], "lead-1");
    expect(searchPexels).not.toHaveBeenCalled();
    expect(result[0].candidates).toEqual([]);
    expect(result[0].pexelsError).toBeNull();
  });

  it("caps total candidates at 9", async () => {
    searchLibraryMock.mockResolvedValue([]);
    const searchPexels = vi.fn(async (): Promise<PexelsResult> => ({
      ok: true,
      candidates: Array.from({ length: 15 }, (_, i) => pexelsCandidate(100 + i)),
    }));
    const result = await sourceImagesForNeeds({ admin, searchPexels }, [needs[0]], "lead-1");
    expect(result[0].candidates).toHaveLength(9);
  });
});
