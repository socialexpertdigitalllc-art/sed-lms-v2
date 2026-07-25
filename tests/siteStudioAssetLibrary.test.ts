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

const LEAD_A = "11111111-1111-1111-1111-111111111111";
const LEAD_B = "22222222-2222-2222-2222-222222222222";

describe("searchLibrary — the client fence", () => {
  it("stock assets are visible to any lead search, including no lead at all", async () => {
    const { state, admin } = makeAdmin();
    await insertAsset(admin, baseFields({ subject: "plumbing van" }));
    const forLeadB = await searchLibrary(admin, { leadId: LEAD_B });
    const noLead = await searchLibrary(admin);
    expect(forLeadB.some((r) => r.subject === "plumbing van")).toBe(true);
    expect(noLead.some((r) => r.subject === "plumbing van")).toBe(true);
    expect(state).toBeTruthy();
  });

  it("lead B never sees lead A's client asset (fenced both directions)", async () => {
    const { admin } = makeAdmin();
    await insertAsset(admin, baseFields({ kind: "client", lead_id: LEAD_A, subject: "storefront a", source: "client_link", pexels_id: null }));
    await insertAsset(admin, baseFields({ kind: "client", lead_id: LEAD_B, subject: "storefront b", source: "client_link", pexels_id: null }));

    const resultsForA = await searchLibrary(admin, { leadId: LEAD_A });
    const resultsForB = await searchLibrary(admin, { leadId: LEAD_B });

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

  it("FENCE INJECTION: a leadId carrying an embedded `.or()` clause is refused outright (fails closed), never widening the fence", async () => {
    const { admin } = makeAdmin();
    await insertAsset(admin, baseFields({ kind: "client", lead_id: LEAD_A, subject: "private a", source: "client_link", pexels_id: null }));
    await insertAsset(admin, baseFields({ kind: "client", lead_id: LEAD_B, subject: "private b", source: "client_link", pexels_id: null }));

    // postgrest-js does zero escaping of `.or()` payloads — a raw comma opens a
    // second clause. A leadId of this shape would, without validation, OR in
    // `kind.eq.client` and return every client's private photos.
    const maliciousLeadId = "00000000-0000-0000-0000-000000000000,kind.eq.client";
    const results = await searchLibrary(admin, { leadId: maliciousLeadId });

    expect(results).toEqual([]); // fails CLOSED — no client rows leak through
    expect(results.some((r) => r.subject === "private a")).toBe(false);
    expect(results.some((r) => r.subject === "private b")).toBe(false);
  });

  it("a well-formed UUID leadId still works correctly on both sides of the fence", async () => {
    const { admin } = makeAdmin();
    await insertAsset(admin, baseFields({ kind: "client", lead_id: LEAD_A, subject: "private a", source: "client_link", pexels_id: null }));
    await insertAsset(admin, baseFields({ kind: "client", lead_id: LEAD_B, subject: "private b", source: "client_link", pexels_id: null }));

    const resultsForA = await searchLibrary(admin, { leadId: LEAD_A });
    expect(resultsForA.some((r) => r.subject === "private a")).toBe(true);
    expect(resultsForA.some((r) => r.subject === "private b")).toBe(false);
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
  new Response(bytes.slice().buffer as ArrayBuffer, { status: 200, headers: { "content-type": contentType } });

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

  it("RACE: a concurrent writer committing the same pexels_id first cleans up our orphaned upload and returns reused:true", async () => {
    const { admin, state } = makeAdmin();
    const bytes = new Uint8Array([1, 2, 3]);

    // Our own short-circuit check (maybeSingle by pexels_id) runs first and
    // finds nothing — the race window is the download+upload time between
    // that check and our own insertAsset call. Simulate a concurrent caller
    // winning that race by inserting the competing row from inside our own
    // fetchImpl, which runs exactly in that window.
    const fetchImpl = vi.fn(async () => {
      state.studio_assets["winner"] = {
        id: "winner", kind: "stock", lead_id: null, subject: "race winner", niche_tags: [],
        width: 4000, height: 2600, source: "pexels", pexels_id: 777, photographer: "Ana",
        storage_path: "winner.jpg", content_type: "image/jpeg", use_count: 0,
        created_at: new Date().toISOString(),
      };
      return jpegResponse(bytes);
    });

    const result = await rehostFromUrl(
      admin,
      "https://images.pexels.com/777/large2x.jpg",
      { kind: "stock", subject: "race loser", source: "pexels", pexels_id: 777 },
      fetchImpl,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reused).toBe(true);
    expect(result.asset.id).toBe("winner"); // the WINNER's row, not a fresh one
    // our own upload must be cleaned up — no bytes left behind under any path
    // other than the winner's.
    const orphanedPaths = Object.keys(state.storage).filter(
      (k) => k.startsWith(`${STUDIO_ASSETS_BUCKET}/`) && k !== `${STUDIO_ASSETS_BUCKET}/winner.jpg`,
    );
    expect(orphanedPaths).toEqual([]);
  });

  it("refuses immediately when Content-Length exceeds the cap, without reading the body at all", async () => {
    const { admin } = makeAdmin();
    const res = new Response(new Uint8Array([1, 2, 3]).buffer as ArrayBuffer, {
      status: 200,
      headers: { "content-type": "image/jpeg", "content-length": String(20 * 1024 * 1024) },
    });
    const arrayBufferSpy = vi.spyOn(res, "arrayBuffer");
    const fetchImpl = vi.fn(async () => res);

    const result = await rehostFromUrl(admin, "https://example.com/huge.jpg", { kind: "stock", subject: "s", source: "upload" }, fetchImpl);

    expect(result.ok).toBe(false);
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });

  it("a chunked stream that exceeds the cap mid-read is refused without buffering the whole body", async () => {
    const { admin } = makeAdmin();
    const chunk = () => new Uint8Array(5 * 1024 * 1024); // 5 MB per chunk, cap is 15 MB
    let index = 0;
    const chunks = [chunk(), chunk(), chunk(), chunk(), chunk()]; // 25 MB total across 5 chunks, cap is 15 MB
    const read = vi.fn(async () => {
      if (index >= chunks.length) return { done: true, value: undefined };
      return { done: false, value: chunks[index++] };
    });
    const cancel = vi.fn(async () => {});
    const fakeRes = {
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "image/jpeg" : null) },
      body: { getReader: () => ({ read, cancel }) },
      arrayBuffer: vi.fn(async () => {
        throw new Error("must not buffer the whole body when streaming is available");
      }),
    };
    const fetchImpl = vi.fn(async () => fakeRes as unknown as Response);

    const result = await rehostFromUrl(admin, "https://example.com/stream.jpg", { kind: "stock", subject: "s", source: "upload" }, fetchImpl);

    expect(result.ok).toBe(false);
    expect(cancel).toHaveBeenCalled();
    expect(read.mock.calls.length).toBeLessThan(chunks.length); // aborted before the last chunk
  });
});
