import { describe, it, expect, vi } from "vitest";
import { resolveAssets, type LoadedAsset } from "@/lib/site-studio/run/resolveAssets";
import { renderSite } from "@/lib/site-studio/render/renderer";
import { finalizeRun } from "@/lib/site-studio/run/finalize";
import { unzipToMap } from "@/lib/site-studio/zip";
import type { CompiledTemplate, ContentDoc } from "@/lib/site-studio/schema";
import { emptyFakeAdminState, makeFakeAdmin } from "./helpers/fakeStudioAdmin";

const dec = (b: Uint8Array) => new TextDecoder().decode(b);

const asset1Bytes = new Uint8Array([1, 2, 3, 4]);
const asset2Bytes = new Uint8Array([5, 6, 7, 8]);

function makeLoader(overrides: Record<string, LoadedAsset | null> = {}) {
  const calls: string[] = [];
  const table: Record<string, LoadedAsset> = {
    "asset-1": { bytes: asset1Bytes, contentType: "image/jpeg", storagePath: "asset-1.jpg" },
    "asset-2": { bytes: asset2Bytes, contentType: "image/png", storagePath: "asset-2.png" },
  };
  const loadAssetBytes = vi.fn(async (assetId: string) => {
    calls.push(assetId);
    if (assetId in overrides) return overrides[assetId];
    return table[assetId] ?? null;
  });
  return { loadAssetBytes, calls };
}

function docWith(pages: ContentDoc["pages"]): ContentDoc {
  return { identity: {}, theme: {}, pages };
}

describe("resolveAssets", () => {
  it("resolves an asset: slot value to a real file at img/studio/{id}.{ext}, on a root page (no prefix)", async () => {
    const { loadAssetBytes } = makeLoader();
    const doc = docWith([
      { page_id: "index", title: "Home", slots: { hero: "asset:asset-1" }, repeats: {} },
    ]);

    const result = await resolveAssets({ loadAssetBytes }, doc);

    expect(result.missing).toEqual([]);
    expect(result.doc.pages[0].slots.hero).toBe("img/studio/asset-1.jpg");
    expect(result.files["img/studio/asset-1.jpg"]).toEqual(asset1Bytes);
  });

  it("uses a DEPTH-CORRECT relative path on a stamped page (output has one path segment -> one '../')", async () => {
    const { loadAssetBytes } = makeLoader();
    const doc = docWith([
      { page_id: "svc", output: "services/drain-cleaning.html", title: "Drain Cleaning", slots: { hero: "asset:asset-1" }, repeats: {} },
    ]);

    const result = await resolveAssets({ loadAssetBytes }, doc);

    expect(result.doc.pages[0].slots.hero).toBe("../img/studio/asset-1.jpg");
  });

  it("fetches a shared asset exactly ONCE even when two slots (across two different pages) pick it", async () => {
    const { loadAssetBytes, calls } = makeLoader();
    const doc = docWith([
      { page_id: "index", title: "Home", slots: { hero: "asset:asset-1" }, repeats: {} },
      { page_id: "about", title: "About", slots: { photo: "asset:asset-1" }, repeats: {} },
    ]);

    const result = await resolveAssets({ loadAssetBytes }, doc);

    expect(calls.filter((id) => id === "asset-1")).toHaveLength(1);
    expect(Object.keys(result.files)).toEqual(["img/studio/asset-1.jpg"]);
    expect(result.doc.pages[0].slots.hero).toBe("img/studio/asset-1.jpg");
    expect(result.doc.pages[1].slots.photo).toBe("img/studio/asset-1.jpg");
  });

  it("leaves non-asset, non-image-shaped slot values (plain text, empty strings) completely untouched", async () => {
    const { loadAssetBytes } = makeLoader();
    const doc = docWith([
      {
        page_id: "index", title: "Home",
        slots: { headline: "Welcome to Acme Plumbing", blurb: "", note: "Call us: never mind, no phone" },
        repeats: {},
      },
    ]);

    const result = await resolveAssets({ loadAssetBytes }, doc);

    expect(result.doc.pages[0].slots).toEqual(doc.pages[0].slots);
  });

  it("an asset that fails to load lands in `missing`, and the slot KEEPS its asset: value", async () => {
    const { loadAssetBytes } = makeLoader({ "asset-1": null });
    const doc = docWith([
      { page_id: "index", title: "Home", slots: { hero: "asset:asset-1" }, repeats: {} },
    ]);

    const result = await resolveAssets({ loadAssetBytes }, doc);

    expect(result.missing).toEqual(["asset-1"]);
    expect(result.doc.pages[0].slots.hero).toBe("asset:asset-1");
    expect(result.files).toEqual({});
  });

  it("does not mutate its input doc", async () => {
    const { loadAssetBytes } = makeLoader();
    const doc = docWith([
      { page_id: "index", title: "Home", slots: { hero: "asset:asset-1" }, repeats: {} },
    ]);
    const before = JSON.parse(JSON.stringify(doc));

    await resolveAssets({ loadAssetBytes }, doc);

    expect(doc).toEqual(before);
  });

  // ---------------------------------------------------------------- probe

  describe("depth probe: a stamped page's untouched template-sample image path", () => {
    const stampedManifest: CompiledTemplate = {
      manifest: {
        engine: 3, name: "probe", version: 1,
        identity: {},
        theme: { mode: "none", roles: {} },
        nav: [],
        pages: [{
          id: "svc", file: "service.html", kind: "service", stampable: true, title_sample: "Service",
          slots: [
            { id: "svc_s1", type: "text", sample: "Service copy", html: false, max_chars: 60 },
            { id: "svc_i1", type: "image", sample: "img/hero.jpg", html: false },
          ],
          repeats: [],
        }],
      },
      pages: {
        "service.html": `<html><head><title>{{title}}</title></head><body><p>{{slot:svc_s1}}</p><img src="{{img:svc_i1}}"></body></html>`,
      },
      fragments: {},
      assets: {},
    };

    const stampedDoc = (heroValue: string): ContentDoc => ({
      identity: {}, theme: {},
      pages: [{
        page_id: "svc", output: "services/drain-cleaning.html", nav_title: "Drain Cleaning",
        title: "Drain Cleaning", slots: { svc_s1: "We fix drains.", svc_i1: heroValue }, repeats: {},
      }],
    });

    it("PROBE RESULT: renderSite does NOT depth-adjust image slot values — the raw sample path renders broken on a nested page", () => {
      const doc = stampedDoc("img/hero.jpg"); // never touched by resolveAssets or a pick
      const rendered = renderSite(stampedManifest, doc);
      expect(rendered.ok).toBe(true);
      if (!rendered.ok) return;
      const html = dec(rendered.files["services/drain-cleaning.html"]);
      // Broken: relative to services/drain-cleaning.html this resolves to
      // services/img/hero.jpg, a 404 on a real deploy. This is the bug the
      // probe was written to surface, confirming resolveAssets must also
      // depth-adjust bare template-relative image values, not just `asset:`
      // ones.
      expect(html).toContain('src="img/hero.jpg"');
    });

    it("FIX: running the doc through resolveAssets FIRST depth-adjusts the bare sample path before it ever reaches the renderer", async () => {
      const doc = stampedDoc("img/hero.jpg");
      const { loadAssetBytes } = makeLoader();
      const resolved = await resolveAssets({ loadAssetBytes }, doc);
      expect(resolved.doc.pages[0].slots.svc_i1).toBe("../img/hero.jpg");

      const rendered = renderSite(stampedManifest, resolved.doc);
      expect(rendered.ok).toBe(true);
      if (!rendered.ok) return;
      const html = dec(rendered.files["services/drain-cleaning.html"]);
      expect(html).toContain('src="../img/hero.jpg"');
      expect(html).not.toContain('src="img/hero.jpg"');
    });

    it("a root (non-stamped) page's sample path is left exactly as-is (prefix is empty)", async () => {
      const rootDoc: ContentDoc = {
        identity: {}, theme: {},
        pages: [{ page_id: "svc", title: "Service", slots: { svc_s1: "Copy", svc_i1: "img/hero.jpg" }, repeats: {} }],
      };
      const { loadAssetBytes } = makeLoader();
      const resolved = await resolveAssets({ loadAssetBytes }, rootDoc);
      expect(resolved.doc.pages[0].slots.svc_i1).toBe("img/hero.jpg");
    });
  });
});

describe("finalizeRun — asset resolution integrated into the zipped site", () => {
  const tpl: CompiledTemplate = {
    manifest: {
      engine: 3, name: "finalize-assets", version: 1,
      identity: {},
      theme: { mode: "none", roles: {} },
      nav: [],
      pages: [{
        id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "Home",
        slots: [{ id: "index_i1", type: "image", sample: "img/hero.jpg", html: false }],
        repeats: [],
      }],
    },
    pages: {
      "index.html": `<html><head><title>{{title}}</title></head><body><img src="{{img:index_i1}}"></body></html>`,
    },
    fragments: {},
    assets: {},
  };

  it("a picked asset lands in the zip's FileMap at img/studio/…, and the HTML references it", async () => {
    const state = emptyFakeAdminState();
    const admin = makeFakeAdmin(state);
    const { loadAssetBytes } = makeLoader();
    const doc: ContentDoc = {
      identity: {}, theme: {},
      pages: [{ page_id: "index", title: "Home", slots: { index_i1: "asset:asset-1" }, repeats: {} }],
    };

    const outcome = await finalizeRun(admin, tpl, doc, "run-assets", { loadAssetBytes });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const zipBytes = state.storage[`studio-sites/${outcome.zipPath}`];
    expect(zipBytes).toBeTruthy();
    const files = unzipToMap(zipBytes!);
    expect(files["img/studio/asset-1.jpg"]).toEqual(asset1Bytes);
    expect(dec(files["index.html"])).toContain('src="img/studio/asset-1.jpg"');
  });

  it("a missing asset fails the run, naming the asset id — a site must never ship with a dangling asset: src", async () => {
    const state = emptyFakeAdminState();
    const admin = makeFakeAdmin(state);
    const { loadAssetBytes } = makeLoader({ "asset-1": null });
    const doc: ContentDoc = {
      identity: {}, theme: {},
      pages: [{ page_id: "index", title: "Home", slots: { index_i1: "asset:asset-1" }, repeats: {} }],
    };

    const outcome = await finalizeRun(admin, tpl, doc, "run-missing-asset", { loadAssetBytes });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect("missingAssets" in outcome ? outcome.missingAssets : []).toContain("asset-1");
  });
});
