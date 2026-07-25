import { describe, it, expect, vi } from "vitest";
import { searchLibrary, insertAsset, bumpUseCount } from "@/lib/site-studio/assets/library";
import { rehostFromUrl, STUDIO_ASSETS_BUCKET } from "@/lib/site-studio/assets/rehost";
import { emptyFakeAdminState, makeFakeAdmin, type FakeAdminState } from "./helpers/fakeStudioAdmin";
import type { AssetRow } from "@/lib/site-studio/assets/types";

const baseFields = (over: Partial<AssetRow> = {}): Omit<AssetRow, "id" | "created_at" | "use_count"> => ({
  kind: "stock",
  lead_id: null,
  subject: "team photo",
  niche_tags: [],
  width: 4000,
  height: 2600,
  source: "pexels",
  pexels_id: null,
  photographer: null,
  storage_path: "some/path.jpg",
  content_type: "image/jpeg",
  ...over,
});

function makeAdmin() {
  const state = emptyFakeAdminState();
  const admin = makeFakeAdmin(state);
  return { state, admin };
}

describe("searchLibrary — the client fence", () => {
  it("stock assets are visible to any lead search, including no lead at all", async () => {
    const { state, admin } = makeAdmin();
    await insertAsset(admin, baseFields({ subject: "plumbing van" }));
    const forLeadB = await searchLibrary(admin, { leadId: "lead-b" });
    const noLead = await searchLibrary(admin);
    expect(forLeadB.some((r) => r.subject === "plumbing van")).toBe(true);
    expect(noLead.some((r) => r.subject === "plumbing van")).toBe(true);
    expect(state).toBeTruthy();
  });

  it("lead B never sees lead A's client asset (fenced both directions)", async () => {
    const { admin } = makeAdmin();
    await insertAsset(admin, baseFields({ kind: "client", lead_id: "lead-a", subject: "storefront a", source: "client_link", pexels_id: null }));
    await insertAsset(admin, baseFields({ kind: "client", lead_id: "lead-b", subject: "storefront b", source: "client_link", pexels_id: null }));

    const resultsForA = await searchLibrary(admin, { leadId: "lead-a" });
    const resultsForB = await searchLibrary(admin, { leadId: "lead-b" });

    expect(resultsForA.some((r) => r.subject === "storefront a")).toBe(true);
    expect(resultsForA.some((r) => r.subject === "storefront b")).toBe(false);

    expect(resultsForB.some((r) => r.subject === "storefront b")).toBe(true);
    expect(resultsForB.some((r) => r.subject === "storefront a")).toBe(false);
  });

  it("filters by subject (ilike, case-insensitive substring) and orders newest first, default limit 60", async () => {
    const { admin } = makeAdmin();
    await insertAsset(admin, baseFields({ subject: "kitchen remodel" }));
    await insertAsset(admin, baseFields({ subject: "bathroom remodel" }));
    await insertAsset(admin, baseFields({ subject: "team photo" }));

    const results = await searchLibrary(admin, { subject: "REMODEL" });
    expect(results.map((r) => r.subject).sort()).toEqual(["bathroom remodel", "kitchen remodel"]);
  });
});

describe("insertAsset — pexels dedupe", () => {
  it("inserts and returns the row", async () => {
    const { admin } = makeAdmin();
    const row = await insertAsset(admin, baseFields({ subject: "hero shot" }));
    expect(row.subject).toBe("hero shot");
    expect(row.id).toBeTruthy();
    expect(row.use_count).toBe(0);
  });

  it("inserting a second asset with the same pexels_id returns the EXISTING row, no duplicate", async () => {
    const { admin, state } = makeAdmin();
    const first = await insertAsset(admin, baseFields({ subject: "first pick", pexels_id: 555 }));
    const second = await insertAsset(admin, baseFields({ subject: "second pick", pexels_id: 555 }));

    expect(second.id).toBe(first.id);
    expect(second.subject).toBe("first pick"); // the ORIGINAL row, not a new one
    expect(Object.keys(state.studio_assets).filter((id) => state.studio_assets[id].pexels_id === 555)).toHaveLength(1);
  });
});

describe("bumpUseCount", () => {
  it("increments use_count", async () => {
    const { admin } = makeAdmin();
    const row = await insertAsset(admin, baseFields({ subject: "van" }));
    expect(row.use_count).toBe(0);
    await bumpUseCount(admin, row.id);
    const [again] = await searchLibrary(admin, { subject: "van" });
    expect(again.use_count).toBe(1);
  });
});

// -------------------------------------------------------------- rehostFromUrl

const jpegResponse = (bytes: Uint8Array, contentType = "image/jpeg") =>
  new Response(bytes, { status: 200, headers: { "content-type": contentType } });

describe("rehostFromUrl", () => {
  it("downloads, uploads to the bucket, and inserts the row only after a successful upload", async () => {
    const { admin, state } = makeAdmin();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchImpl = vi.fn(async () => jpegResponse(bytes));

    const result = await rehostFromUrl(
      admin,
      "https://images.pexels.com/1/large2x.jpg",
      { kind: "stock", subject: "plumbing van", source: "pexels", pexels_id: 42, photographer: "Ana" },
      fetchImpl,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reused).toBe(false);
    expect(result.asset.content_type).toBe("image/jpeg");
    expect(result.asset.storage_path).toMatch(/\.jpg$/);
    const stored = state.storage[`${STUDIO_ASSETS_BUCKET}/${result.asset.storage_path}`];
    expect(stored).toEqual(bytes);
    expect(state.studio_assets[result.asset.id]).toBeTruthy();
  });

  it("refuses non-image/* content types with {ok:false}, never throws", async () => {
    const { admin } = makeAdmin();
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "text/html" } }));
    const result = await rehostFromUrl(admin, "https://example.com/x", { kind: "stock", subject: "s", source: "upload" }, fetchImpl);
    expect(result.ok).toBe(false);
  });

  it("refuses bodies over 15 MB with {ok:false}, never throws", async () => {
    const { admin } = makeAdmin();
    const big = new Uint8Array(15 * 1024 * 1024 + 1);
    const fetchImpl = vi.fn(async () => jpegResponse(big));
    const result = await rehostFromUrl(admin, "https://example.com/big.jpg", { kind: "stock", subject: "s", source: "upload" }, fetchImpl);
    expect(result.ok).toBe(false);
  });

  it("a storage upload failure surfaces {ok:false} and does NOT leave an orphan studio_assets row", async () => {
    const { admin, state } = makeAdmin();
    state.uploadShouldFail = () => "simulated storage outage";
    const fetchImpl = vi.fn(async () => jpegResponse(new Uint8Array([9, 9, 9])));

    const result = await rehostFromUrl(admin, "https://example.com/y.jpg", { kind: "stock", subject: "s", source: "upload" }, fetchImpl);

    expect(result.ok).toBe(false);
    expect(Object.keys(state.studio_assets)).toHaveLength(0);
  });

  it("passing meta.pexels_id that already exists short-circuits: no download, reused:true", async () => {
    const { admin } = makeAdmin();
    const existing = await insertAsset(admin, baseFields({ subject: "already here", pexels_id: 909, storage_path: "909.jpg" }));
    const fetchImpl = vi.fn(async () => jpegResponse(new Uint8Array([1])));

    const result = await rehostFromUrl(
      admin,
      "https://images.pexels.com/909/large2x.jpg",
      { kind: "stock", subject: "already here", source: "pexels", pexels_id: 909 },
      fetchImpl,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reused).toBe(true);
    expect(result.asset.id).toBe(existing.id);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
