import { describe, it, expect, vi, beforeEach } from "vitest";
import { updateTemplate } from "@/lib/site-builder/templates";
import { zipFromMap } from "@/lib/site-studio/zip";

/**
 * Covers became required for new uploads, which left every template uploaded
 * before that unable to get one — and therefore unable to go in service.
 * Editing exists so an existing template can be brought up to standard, and
 * so updated files can ship without re-uploading the template as a new one.
 */

type Row = { storage_path: string; cover_image_path: string | null };

function makeAdmin(row: Row | null) {
  const uploads: { path: string; contentType: string; upsert: boolean }[] = [];
  const removed: string[] = [];
  let patched: Record<string, unknown> | null = null;

  const table = {
    select: () => table,
    eq: () => table,
    update: (p: Record<string, unknown>) => {
      patched = p;
      return table;
    },
    single: async () =>
      patched
        ? { data: { id: "t-1", ...patched }, error: null }
        : { data: row, error: row ? null : { message: "no rows" } },
  };

  const admin = {
    from: () => table,
    storage: {
      from: () => ({
        upload: async (path: string, _b: unknown, o: { contentType: string; upsert: boolean }) => {
          uploads.push({ path, contentType: o.contentType, upsert: o.upsert });
          return { error: null };
        },
        remove: async (paths: string[]) => {
          removed.push(...paths);
          return { error: null };
        },
      }),
    },
  };
  return { admin: admin as never, uploads, removed, patch: () => patched };
}

const PNG = { bytes: new Uint8Array([1, 2, 3]), ext: "png", contentType: "image/png" };
const base = (): Row => ({ storage_path: "t-1/source.zip", cover_image_path: null });

beforeEach(() => vi.clearAllMocks());

describe("updateTemplate", () => {
  it("adds a cover to a template that never had one", async () => {
    const { admin, uploads, patch } = makeAdmin(base());
    await updateTemplate(admin, "t-1", { cover: PNG });

    expect(uploads).toEqual([{ path: "t-1/cover.png", contentType: "image/png", upsert: true }]);
    expect(patch()).toEqual({ cover_image_path: "t-1/cover.png" });
  });

  it("removes the old cover when the new one is a different image type", async () => {
    // A different type means a different key, so the old object would
    // otherwise linger in the bucket unreferenced forever.
    const { admin, removed } = makeAdmin({ storage_path: "t-1/source.zip", cover_image_path: "t-1/cover.jpg" });
    await updateTemplate(admin, "t-1", { cover: PNG });
    expect(removed).toEqual(["t-1/cover.jpg"]);
  });

  it("overwrites in place when the type is unchanged, deleting nothing", async () => {
    const { admin, removed, uploads } = makeAdmin({ storage_path: "t-1/source.zip", cover_image_path: "t-1/cover.png" });
    await updateTemplate(admin, "t-1", { cover: PNG });
    expect(removed).toEqual([]);
    expect(uploads[0].upsert).toBe(true);
  });

  it("renames, trimming the input", async () => {
    const { admin, patch } = makeAdmin(base());
    await updateTemplate(admin, "t-1", { name: "  Plumber Pro v2 " });
    expect(patch()).toEqual({ name: "Plumber Pro v2" });
  });

  it("refuses a blank rename", async () => {
    const { admin } = makeAdmin(base());
    await expect(updateTemplate(admin, "t-1", { name: "   " })).rejects.toThrow(/name is required/i);
  });

  it("replaces the source zip and re-reads its pages and assets", async () => {
    const { admin, uploads, patch } = makeAdmin(base());
    const zip = zipFromMap({
      "index.html": new TextEncoder().encode("<h1>hi</h1>"),
      "about.html": new TextEncoder().encode("<h1>about</h1>"),
      "css/style.css": new TextEncoder().encode("body{}"),
    });

    await updateTemplate(admin, "t-1", { zip });

    // Overwrites the SAME key: one source per template.
    expect(uploads).toEqual([
      { path: "t-1/source.zip", contentType: "application/zip", upsert: true },
    ]);
    expect(patch()).toEqual({
      page_files: ["about.html", "index.html"],
      asset_files: ["css/style.css"],
    });
  });

  it("refuses a replacement zip with no pages, leaving the template alone", async () => {
    const { admin, patch } = makeAdmin(base());
    const zip = zipFromMap({ "css/style.css": new TextEncoder().encode("body{}") });
    await expect(updateTemplate(admin, "t-1", { zip })).rejects.toThrow(/no \.html pages/i);
    expect(patch()).toBeNull();
  });

  it("applies a rename, a cover and new files together", async () => {
    const { admin, patch } = makeAdmin(base());
    const zip = zipFromMap({ "index.html": new TextEncoder().encode("<h1>hi</h1>") });
    await updateTemplate(admin, "t-1", { name: "Renamed", cover: PNG, zip });

    expect(patch()).toMatchObject({
      name: "Renamed",
      cover_image_path: "t-1/cover.png",
      page_files: ["index.html"],
    });
  });

  it("refuses an empty edit rather than writing nothing", async () => {
    const { admin } = makeAdmin(base());
    await expect(updateTemplate(admin, "t-1", {})).rejects.toThrow(/nothing to update/i);
  });

  it("reports a missing template as not found", async () => {
    const { admin } = makeAdmin(null);
    await expect(updateTemplate(admin, "nope", { name: "x" })).rejects.toThrow(/not found/i);
  });
});
