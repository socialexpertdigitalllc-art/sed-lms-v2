import { describe, it, expect, vi } from "vitest";
import { searchLibrary, insertAsset, bumpUseCount } from "@/lib/site-studio/assets/library";
import { rehostFromUrl, STUDIO_ASSETS_BUCKET, probeImageDimensions } from "@/lib/site-studio/assets/rehost";
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

// ---------------------------------------------------------- probeImageDimensions

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // signature
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8); // IHDR chunk length (13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

/** Minimal JPEG: SOI, one APP0 segment (16 bytes, ignored), then an SOF0
 *  frame header naming the given width/height, 3 components. */
function jpegBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(39);
  bytes.set([0xff, 0xd8], 0); // SOI
  bytes.set([0xff, 0xe0], 2); // APP0 marker
  bytes.set([0x00, 0x10], 4); // length 16 (2 length bytes + 14 payload bytes)
  // 14 bytes of APP0 payload — content irrelevant to the probe
  bytes.set([0xff, 0xc0], 20); // SOF0 marker
  bytes.set([0x00, 0x11], 22); // length 17
  bytes[24] = 0x08; // precision
  const view = new DataView(bytes.buffer);
  view.setUint16(25, height, false);
  view.setUint16(27, width, false);
  bytes[29] = 0x03; // numComponents
  return bytes;
}

function webpVp8xBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  bytes.set([0x00, 0x00, 0x00, 0x00], 4); // riff size (unused by the probe)
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  bytes.set([0x56, 0x50, 0x38, 0x58], 12); // "VP8X"
  bytes.set([0x0a, 0x00, 0x00, 0x00], 16); // chunk size 10
  bytes[20] = 0x00; // flags
  const w1 = width - 1, h1 = height - 1;
  bytes[24] = w1 & 0xff; bytes[25] = (w1 >> 8) & 0xff; bytes[26] = (w1 >> 16) & 0xff;
  bytes[27] = h1 & 0xff; bytes[28] = (h1 >> 8) & 0xff; bytes[29] = (h1 >> 16) & 0xff;
  return bytes;
}

describe("probeImageDimensions — magic-bytes dimension probe (no image library)", () => {
  it("reads PNG width/height from the IHDR chunk", () => {
    expect(probeImageDimensions(pngBytes(800, 600), "image/png")).toEqual({ width: 800, height: 600 });
  });

  it("reads JPEG width/height from the first SOF0 segment, skipping earlier markers", () => {
    expect(probeImageDimensions(jpegBytes(80, 60), "image/jpeg")).toEqual({ width: 80, height: 60 });
  });

  it("reads WEBP (VP8X extended format) width/height", () => {
    expect(probeImageDimensions(webpVp8xBytes(300, 200), "image/webp")).toEqual({ width: 300, height: 200 });
  });

  it("returns null for an unrecognised content type", () => {
    expect(probeImageDimensions(pngBytes(10, 10), "image/gif")).toBeNull();
  });

  it("returns null (never throws) on truncated/malformed bytes", () => {
    expect(probeImageDimensions(new Uint8Array([1, 2, 3]), "image/png")).toBeNull();
    expect(probeImageDimensions(new Uint8Array([1, 2, 3]), "image/jpeg")).toBeNull();
    expect(probeImageDimensions(new Uint8Array([1, 2, 3]), "image/webp")).toBeNull();
    expect(probeImageDimensions(new Uint8Array(0), "image/png")).toBeNull();
  });

  it("returns null for a PNG-content-type byte string with the wrong signature", () => {
    const bad = pngBytes(10, 10);
    bad[0] = 0x00; // corrupt the signature
    expect(probeImageDimensions(bad, "image/png")).toBeNull();
  });
});
