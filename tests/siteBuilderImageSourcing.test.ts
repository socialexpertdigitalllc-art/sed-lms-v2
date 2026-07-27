// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { sourceImages, type SourcedCandidate } from "@/lib/site-builder/imageSourcing";
import type { ImageNeedsResult } from "@/lib/site-builder/imageNeeds";
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

function needsFor(services: string[]): ImageNeedsResult {
  return { services: services.map((service) => ({ service, query: service })), servicesTruncated: false, droppedServices: [] };
}

function libraryAssetId(c: SourcedCandidate): string | null {
  return c.kind === "library" ? c.asset_id : null;
}

const admin = {} as never; // never touched directly — only passed through to the mocked searchLibrary

describe("sourceImages — Hero composition", () => {
  it("3 services + a client photo -> 5 hero candidates: one from each of the first 3 service searches, plus one client photo", async () => {
    searchLibraryMock.mockImplementation(async (_admin: unknown, opts: { subject?: string }) =>
      Array.from({ length: 9 }, (_, i) => libraryRow(`${opts.subject}-${i}`)),
    );
    const searchPexels = vi.fn();
    const needs = needsFor(["Service A", "Service B", "Service C"]);

    const result = await sourceImages({ admin, searchPexels }, needs, "lead-1", ["https://example.com/client1.jpg"]);

    expect(result.hero).toHaveLength(5);
    const heroLibraryIds = result.hero.map(libraryAssetId).filter((x): x is string => x !== null);
    // One from each of the first 3 services' own searches (their top result)...
    expect(heroLibraryIds).toContain("Service A-0");
    expect(heroLibraryIds).toContain("Service B-0");
    expect(heroLibraryIds).toContain("Service C-0");
    // ...topped up with exactly 1 filler (3 services + 1 client photo = 4, needs 1 more to reach 5).
    expect(heroLibraryIds).toHaveLength(4);
    // ...and exactly one client photo.
    const clientCandidates = result.hero.filter((c) => c.kind === "client");
    expect(clientCandidates).toHaveLength(1);
    expect(clientCandidates[0]).toMatchObject({ kind: "client", url: "https://example.com/client1.jpg" });
  });

  it("no client photos -> still 5, topped up with 2 fillers from the same service searches", async () => {
    searchLibraryMock.mockImplementation(async (_admin: unknown, opts: { subject?: string }) =>
      Array.from({ length: 9 }, (_, i) => libraryRow(`${opts.subject}-${i}`)),
    );
    const searchPexels = vi.fn();
    const needs = needsFor(["Service A", "Service B", "Service C"]);

    const result = await sourceImages({ admin, searchPexels }, needs, "lead-1", []);

    expect(result.hero).toHaveLength(5);
    expect(result.hero.every((c) => c.kind === "library")).toBe(true);
    expect(result.hero.some((c) => c.kind === "client")).toBe(false);
  });

  it("fewer than 3 services (2) -> still tops up to 5, spread across the services that exist", async () => {
    searchLibraryMock.mockImplementation(async (_admin: unknown, opts: { subject?: string }) =>
      Array.from({ length: 9 }, (_, i) => libraryRow(`${opts.subject}-${i}`)),
    );
    const searchPexels = vi.fn();
    const needs = needsFor(["Service A", "Service B"]);

    const result = await sourceImages({ admin, searchPexels }, needs, "lead-1", []);

    expect(result.hero).toHaveLength(5);
    const heroLibraryIds = result.hero.map(libraryAssetId).filter((x): x is string => x !== null);
    expect(heroLibraryIds.some((id) => id.startsWith("Service A"))).toBe(true);
    expect(heroLibraryIds.some((id) => id.startsWith("Service B"))).toBe(true);
  });

  it("0 services -> sensible non-crash: hero is just the client photo, never throws", async () => {
    const searchPexels = vi.fn();
    const needs = needsFor([]);

    const result = await sourceImages({ admin, searchPexels }, needs, "lead-1", ["https://example.com/client1.jpg"]);

    expect(result.hero).toEqual([
      { kind: "client", key: "client:https://example.com/client1.jpg", url: "https://example.com/client1.jpg" },
    ]);
    expect(result.services).toEqual([]);
    expect(searchPexels).not.toHaveBeenCalled();
  });

  it("0 services and no client photos -> hero is simply empty, never throws", async () => {
    const searchPexels = vi.fn();
    const needs = needsFor([]);

    const result = await sourceImages({ admin, searchPexels }, needs, "lead-1", []);

    expect(result.hero).toEqual([]);
    expect(result.services).toEqual([]);
  });
});

describe("sourceImages — service rows", () => {
  it("each row's own candidates are whatever's left after Hero's single claim, never calling Pexels once the library clears the top-up threshold", async () => {
    searchLibraryMock.mockResolvedValue([libraryRow("a"), libraryRow("b"), libraryRow("c"), libraryRow("d")]);
    const searchPexels = vi.fn();
    const needs = needsFor(["Plumbing"]);

    const result = await sourceImages({ admin, searchPexels }, needs, "lead-1", []);

    expect(searchPexels).not.toHaveBeenCalled();
    expect(result.hero).toHaveLength(1); // Hero's one claim from this single service
    expect(result.hero.every((c) => c.kind === "library")).toBe(true);
    expect(result.services[0].candidates).toHaveLength(3); // the next 3
    expect(result.services[0].candidates.every((c) => c.kind === "library")).toBe(true);
    expect(result.services[0].pexelsError).toBeNull();
  });

  it("tops up with Pexels when the library falls short of the threshold", async () => {
    searchLibraryMock.mockResolvedValue([libraryRow("a")]);
    const searchPexels = vi.fn(async (): Promise<PexelsResult> => ({
      ok: true,
      candidates: [pexelsCandidate(1), pexelsCandidate(2), pexelsCandidate(3)],
    }));
    const needs = needsFor(["Plumbing"]);

    const result = await sourceImages({ admin, searchPexels }, needs, "lead-1", []);

    expect(searchPexels).toHaveBeenCalledWith("Plumbing");
    expect(result.hero[0]).toMatchObject({ kind: "library", asset_id: "a" });
    expect(result.services[0].candidates.map((c) => c.kind)).toEqual(["pexels", "pexels", "pexels"]);
  });

  it("filters out undersized Pexels results", async () => {
    searchLibraryMock.mockResolvedValue([]);
    const searchPexels = vi.fn(async (): Promise<PexelsResult> => ({
      ok: true,
      candidates: [pexelsCandidate(1, { width: 400, height: 300 }), pexelsCandidate(2)],
    }));
    const needs = needsFor(["Plumbing"]);

    const result = await sourceImages({ admin, searchPexels }, needs, "lead-1", []);

    // Only candidate 2 survives the dimension filter, and becomes Hero's sole claim.
    expect(result.hero).toHaveLength(1);
    expect(result.hero[0]).toMatchObject({ kind: "pexels", pexels_id: 2 });
    expect(result.services[0].candidates).toEqual([]);
  });

  it("a Pexels failure for one service's row degrades that row only, never throws", async () => {
    searchLibraryMock.mockResolvedValue([]);
    const searchPexels = vi.fn(async (query: string): Promise<PexelsResult> => {
      if (query === "Plumbing") return { ok: false, error: "pexels HTTP 500" };
      return { ok: true, candidates: [pexelsCandidate(9), pexelsCandidate(10), pexelsCandidate(11), pexelsCandidate(12)] };
    });
    const needs = needsFor(["Plumbing", "Drain Cleaning"]);

    const result = await sourceImages({ admin, searchPexels }, needs, "lead-1", []);

    expect(result.services[0].service).toBe("Plumbing");
    expect(result.services[0].candidates).toEqual([]);
    expect(result.services[0].pexelsError).toBe("pexels HTTP 500");
    expect(result.services[1].service).toBe("Drain Cleaning");
    expect(result.services[1].pexelsError).toBeNull();
  });

  it("a library search throwing degrades to zero library candidates, not a thrown error", async () => {
    searchLibraryMock.mockRejectedValue(new Error("db down"));
    const searchPexels = vi.fn(async (): Promise<PexelsResult> => ({ ok: true, candidates: [pexelsCandidate(1)] }));
    const needs = needsFor(["Plumbing"]);

    const result = await sourceImages({ admin, searchPexels }, needs, "lead-1", []);

    expect(result.hero).toHaveLength(1);
    expect(result.hero[0].kind).toBe("pexels");
  });

  it("dedupes candidates globally across services — the same photo never appears twice", async () => {
    searchLibraryMock.mockImplementation(async () => [libraryRow("shared"), libraryRow("shared")]);
    const searchPexels = vi.fn(async (): Promise<PexelsResult> => ({ ok: true, candidates: [] }));
    const needs = needsFor(["Plumbing", "Drain Cleaning"]);

    const result = await sourceImages({ admin, searchPexels }, needs, "lead-1", []);

    expect(result.hero.map(libraryAssetId)).toEqual(["shared"]);
    // The second service's identical search surfaces the same row again, but
    // it was already claimed globally — nothing left for its own row.
    expect(result.services[1].candidates).toEqual([]);
  });

  it("dedupes Pexels ids globally across services", async () => {
    searchLibraryMock.mockResolvedValue([]);
    const searchPexels = vi.fn(async (): Promise<PexelsResult> => ({ ok: true, candidates: [pexelsCandidate(42)] }));
    const needs = needsFor(["Plumbing", "Drain Cleaning"]);

    const result = await sourceImages({ admin, searchPexels }, needs, "lead-1", []);

    expect(result.hero).toHaveLength(1); // claimed by the first service
    expect(result.services[1].candidates).toEqual([]); // same pexels_id already used
  });

  it("skips the Pexels call entirely for a service with an empty query", async () => {
    searchLibraryMock.mockResolvedValue([]);
    const searchPexels = vi.fn();
    const needs: ImageNeedsResult = { services: [{ service: "X", query: "" }], servicesTruncated: false, droppedServices: [] };

    const result = await sourceImages({ admin, searchPexels }, needs, "lead-1", []);

    expect(searchPexels).not.toHaveBeenCalled();
    expect(result.services[0].candidates).toEqual([]);
    expect(result.services[0].pexelsError).toBeNull();
  });

  it("caps the raw pool per service at 9, so a service's total draw (hero + row + fillers) never exceeds it", async () => {
    searchLibraryMock.mockResolvedValue([]);
    const searchPexels = vi.fn(async (): Promise<PexelsResult> => ({
      ok: true,
      candidates: Array.from({ length: 15 }, (_, i) => pexelsCandidate(100 + i)),
    }));
    const needs = needsFor(["Plumbing"]);

    const result = await sourceImages({ admin, searchPexels }, needs, "lead-1", []);

    const totalDrawn = result.hero.length + result.services[0].candidates.length;
    expect(totalDrawn).toBeLessThanOrEqual(9);
    expect(result.hero).toHaveLength(5); // 1 claim + 4 fillers, all from this one service
    expect(result.services[0].candidates).toHaveLength(3);
  });

  it("the query passed through to each row is the bare service name — never anything with 'custom website' baked in", () => {
    // Regression guard for the actual shipped bug: a query built from the
    // lead's `site_type` (a sales field, sometimes literally "Custom
    // Website"). ImageNeedsResult rows only ever carry `query === service`.
    const needs = needsFor(["Window Tinting", "Ceramic Coating", "Paint Correction"]);
    for (const s of needs.services) {
      expect(s.query).toBe(s.service);
      expect(s.query.toLowerCase()).not.toContain("custom website");
    }
  });
});
