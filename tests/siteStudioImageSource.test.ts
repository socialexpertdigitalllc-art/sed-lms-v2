import { describe, it, expect, vi } from "vitest";
import { imageSlotQueries, sourceImages } from "@/lib/site-studio/run/imageSource";
import { insertAsset } from "@/lib/site-studio/assets/library";
import { emptyFakeAdminState, makeFakeAdmin } from "./helpers/fakeStudioAdmin";
import type { TemplateManifest, ContentDoc } from "@/lib/site-studio/schema";
import type { Dossier } from "@/lib/site-studio/run/dossier";
import type { PexelsResult } from "@/lib/site-studio/assets/pexels";
import type { AssetRow } from "@/lib/site-studio/assets/types";

function dossier(over: Partial<Dossier> = {}): Dossier {
  return {
    lead_id: "lead1",
    business_name: "Acme Plumbing",
    no_email: false,
    services: ["Drain Cleaning"],
    service_areas: [],
    requested_pages: [],
    design_references: [],
    add_ons: [],
    client_photos: [],
    ...over,
  };
}

const manifest: TemplateManifest = {
  engine: 3, name: "img-source-test", version: 1,
  identity: {},
  theme: { mode: "none", roles: {} },
  nav: [],
  pages: [
    {
      id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "Home",
      slots: [
        { id: "index_s1", type: "text", sample: "Welcome", html: false },
        { id: "index_i1", type: "image", sample: "img/team-photo.jpg", html: false },
      ],
      repeats: [],
    },
    {
      id: "about", file: "about.html", kind: "about", stampable: false, title_sample: "About",
      slots: [
        { id: "about_i1", type: "image", sample: "img/hero.jpg", html: false, subject_hint: "office building" },
      ],
      repeats: [],
    },
  ],
};

const doc: ContentDoc = {
  identity: {},
  theme: {},
  pages: [
    { page_id: "index", title: "Home", slots: { index_s1: "Welcome", index_i1: "img/team-photo.jpg" }, repeats: {} },
    { page_id: "about", title: "About", slots: { about_i1: "img/hero.jpg" }, repeats: {} },
  ],
};

describe("imageSlotQueries", () => {
  it("one entry per image slot, key = `${docPageIndex}:${slotId}`, text slots ignored", () => {
    const result = imageSlotQueries(manifest, doc, dossier());
    expect(result).toEqual([
      { key: "0:index_i1", page_id: "index", slot_id: "index_i1", query: "team photo drain cleaning" },
      { key: "1:about_i1", page_id: "about", slot_id: "about_i1", query: "office building drain cleaning" },
    ]);
  });

  it("uses dossier.site_type over the first service when both are present", () => {
    const result = imageSlotQueries(manifest, doc, dossier({ site_type: "Plumber", services: ["Drain Cleaning"] }));
    expect(result[0].query).toBe("team photo plumber");
  });

  it("falls back to the first service phrase verbatim (lowercased), never a guessed trade taxonomy", () => {
    const result = imageSlotQueries(manifest, doc, dossier({ site_type: undefined, services: ["Sewer Repair"] }));
    expect(result[0].query).toBe("team photo sewer repair");
  });

  it("derives subject words from the sample filename when no subject_hint is present (img/team-photo.jpg -> 'team photo')", () => {
    const result = imageSlotQueries(manifest, doc, dossier({ services: [] }));
    expect(result[0].query).toBe("team photo");
  });

  it("is deterministic: identical inputs produce identical output, in doc order", () => {
    const a = imageSlotQueries(manifest, doc, dossier());
    const b = imageSlotQueries(manifest, doc, dossier());
    expect(a).toEqual(b);
    expect(a.map((q) => q.key)).toEqual(["0:index_i1", "1:about_i1"]);
  });
});

// -------------------------------------------------------------- sourceImages

function makeAdmin() {
  const state = emptyFakeAdminState();
  const admin = makeFakeAdmin(state);
  return { state, admin };
}

const pexelsCandidate = (id: number, width = 4000, height = 2600) => ({
  kind: "pexels" as const,
  pexels_id: id,
  thumb_url: `https://images.pexels.com/${id}/medium.jpg`,
  download_url: `https://images.pexels.com/${id}/large2x.jpg`,
  width,
  height,
  photographer: "Ana",
});

describe("sourceImages", () => {
  it("always returns every slot key, even when Pexels fails entirely", async () => {
    const { admin } = makeAdmin();
    const log = vi.fn();
    const searchPexels = vi.fn(async (): Promise<PexelsResult> => ({ ok: false, error: "pexels down" }));

    const result = await sourceImages({ admin, searchPexels, log }, manifest, doc, dossier(), "lead1");

    expect(Object.keys(result).sort()).toEqual(["0:index_i1", "1:about_i1"]);
    expect(result["0:index_i1"].candidates).toEqual([]);
    expect(result["0:index_i1"].query).toBe("team photo drain cleaning");
    expect(typeof result["0:index_i1"].sourced_at).toBe("string");
    // exactly one warn for the whole call, not one per slot/query
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toBe("warn");
  });

  it("never throws even if searchPexels rejects", async () => {
    const { admin } = makeAdmin();
    const searchPexels = vi.fn(async (): Promise<PexelsResult> => {
      throw new Error("boom");
    });
    await expect(sourceImages({ admin, searchPexels }, manifest, doc, dossier(), "lead1")).resolves.toBeTruthy();
  });

  it("library candidates come first; Pexels is not called when the library already has >= 4", async () => {
    const { admin } = makeAdmin();
    for (let i = 0; i < 4; i++) {
      await insertAsset(admin, {
        kind: "stock", lead_id: null, subject: "team photo drain cleaning", niche_tags: [],
        width: 2000, height: 1500, source: "upload", pexels_id: null, photographer: null,
        storage_path: `lib-${i}.jpg`, content_type: "image/jpeg",
      } as Omit<AssetRow, "id" | "created_at" | "use_count">);
    }
    const searchPexels = vi.fn(async (): Promise<PexelsResult> => ({ ok: true, candidates: [pexelsCandidate(1)] }));

    const result = await sourceImages({ admin, searchPexels }, manifest, doc, dossier(), "lead1");

    expect(result["0:index_i1"].candidates).toHaveLength(4);
    expect(result["0:index_i1"].candidates.every((c) => c.kind === "library")).toBe(true);
    // about_i1's query differs ("office building ..."), so it's still topped up —
    // only the index slot's own (well-stocked) query should skip Pexels.
    expect(searchPexels).toHaveBeenCalledWith("office building drain cleaning");
    expect(searchPexels).not.toHaveBeenCalledWith("team photo drain cleaning");
  });

  it("tops up from Pexels when the library has fewer than 4, applying cheap dimension filters and a 9-item cap", async () => {
    const { admin } = makeAdmin();
    const searchPexels = vi.fn(async (): Promise<PexelsResult> => ({
      ok: true,
      candidates: [
        pexelsCandidate(1, 4000, 2600),
        pexelsCandidate(2, 800, 600),   // too small, filtered out
        pexelsCandidate(3, 1600, 400),  // too short, filtered out
        ...Array.from({ length: 10 }, (_, i) => pexelsCandidate(100 + i)), // would overflow the cap
      ],
    }));

    const result = await sourceImages({ admin, searchPexels }, manifest, doc, dossier(), "lead1");

    const candidates = result["0:index_i1"].candidates;
    expect(candidates.length).toBeLessThanOrEqual(9);
    expect(candidates.some((c) => c.kind === "pexels" && c.pexels_id === 2)).toBe(false);
    expect(candidates.some((c) => c.kind === "pexels" && c.pexels_id === 3)).toBe(false);
    expect(candidates.some((c) => c.kind === "pexels" && c.pexels_id === 1)).toBe(true);
  });

  it("dedupes by pexels_id across the whole run: the same photo is never offered twice across different slot queries", async () => {
    const { admin } = makeAdmin();
    const searchPexels = vi.fn(async (): Promise<PexelsResult> => ({
      ok: true,
      candidates: [pexelsCandidate(42)],
    }));

    const result = await sourceImages({ admin, searchPexels }, manifest, doc, dossier(), "lead1");

    const allPexelsIds = Object.values(result).flatMap((s) =>
      s.candidates.filter((c) => c.kind === "pexels").map((c) => (c as { pexels_id: number }).pexels_id),
    );
    expect(allPexelsIds).toEqual([42]); // only the FIRST slot to want it gets it
  });

  it("scopes library candidates to this lead's own client photos plus shared stock (the fence)", async () => {
    const { admin } = makeAdmin();
    await insertAsset(admin, {
      kind: "client", lead_id: "lead-other", subject: "team photo drain cleaning", niche_tags: [],
      width: 2000, height: 1500, source: "client_link", pexels_id: null, photographer: null,
      storage_path: "other.jpg", content_type: "image/jpeg",
    } as Omit<AssetRow, "id" | "created_at" | "use_count">);
    const searchPexels = vi.fn(async (): Promise<PexelsResult> => ({ ok: false, error: "n/a" }));

    const result = await sourceImages({ admin, searchPexels }, manifest, doc, dossier(), "lead1");

    expect(result["0:index_i1"].candidates).toEqual([]); // lead-other's client photo never leaks to lead1
  });
});
