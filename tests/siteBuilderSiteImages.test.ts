// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  extensionFor,
  siteImagePath,
  isSiteImagePath,
  siteImagesFromZip,
  localizeImages,
  SITE_IMAGE_DIR,
} from "@/lib/site-builder/siteImages";
import type { SuppliedImage } from "@/lib/site-builder/prompt";

const enc = new TextEncoder();

/** A signed Supabase URL of the exact shape that broke production: private
 *  bucket, `object/sign`, mandatory `?token=<JWT>`. */
const signed = (id: string) =>
  `https://ikuvbxjkoojtgekapbul.supabase.co/storage/v1/object/sign/studio-assets/${id}.jpg?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${"x".repeat(180)}`;

function imageResponse(bytes: Uint8Array, contentType = "image/jpeg"): Response {
  return new Response(bytes.slice().buffer as ArrayBuffer, { status: 200, headers: { "content-type": contentType } });
}

describe("extensionFor", () => {
  it("prefers the content type", () => {
    expect(extensionFor("https://x.test/a", "image/png")).toBe("png");
    expect(extensionFor("https://x.test/a.jpg", "image/webp")).toBe("webp");
  });

  it("falls back to the URL's own extension, normalising jpeg to jpg", () => {
    expect(extensionFor("https://x.test/a.png", null)).toBe("png");
    expect(extensionFor("https://x.test/a.jpeg", null)).toBe("jpg");
  });

  it("ignores a query string when reading the URL extension", () => {
    expect(extensionFor(signed("abc"), null)).toBe("jpg");
  });

  it("defaults to jpg for anything unrecognised", () => {
    expect(extensionFor("https://x.test/download?id=7", null)).toBe("jpg");
    expect(extensionFor("not a url at all", "application/octet-stream")).toBe("jpg");
  });
});

describe("siteImagePath", () => {
  it("builds a short, readable, relative path", () => {
    expect(siteImagePath("Hero", 0, "jpg")).toBe(`${SITE_IMAGE_DIR}/hero-1.jpg`);
    expect(siteImagePath("Service: Drain Cleaning", 2, "png")).toBe(`${SITE_IMAGE_DIR}/service-drain-cleaning-3.png`);
  });

  it("never emits an absolute URL, a query string, or a token", () => {
    const p = siteImagePath("Hero", 0, "jpg");
    expect(p).not.toMatch(/^https?:/);
    expect(p).not.toContain("?");
    expect(p).not.toContain("token");
  });

  it("survives a purpose with no usable characters", () => {
    expect(siteImagePath("///", 0, "jpg")).toBe(`${SITE_IMAGE_DIR}/image-1.jpg`);
  });
});

describe("isSiteImagePath / siteImagesFromZip", () => {
  it("recognises only bundled images", () => {
    expect(isSiteImagePath("images/hero-1.jpg")).toBe(true);
    expect(isSiteImagePath("index.html")).toBe(false);
    expect(isSiteImagePath("img/template-photo.jpg")).toBe(false);
  });

  it("extracts just the bundled images out of an assembled site", () => {
    const files = {
      "index.html": enc.encode("<html></html>"),
      "style.css": enc.encode("body{}"),
      "images/hero-1.jpg": enc.encode("JPEGBYTES"),
      "images/gallery-1.png": enc.encode("PNGBYTES"),
    };
    expect(Object.keys(siteImagesFromZip(files)).sort()).toEqual(["images/gallery-1.png", "images/hero-1.jpg"]);
  });
});

describe("localizeImages", () => {
  const picks: SuppliedImage[] = [
    { url: signed("aaa"), purpose: "Hero" },
    { url: signed("bbb"), purpose: "Hero" },
    { url: signed("ccc"), purpose: "Service: Drains" },
  ];

  it("REGRESSION: the model is handed relative paths, never a tokenised storage URL", async () => {
    // The production failure: a signed URL's mandatory ?token= was dropped by
    // the model when it wrote the <img src>, so the live site's images 400'd
    // with "querystring must have required property 'token'". A path with no
    // query string at all cannot fail that way.
    const fetchImpl = vi.fn(async () => imageResponse(enc.encode("BYTES")));
    const { images, files } = await localizeImages(picks, fetchImpl as unknown as typeof fetch);

    expect(images).toHaveLength(3);
    for (const img of images) {
      expect(img.url).not.toContain("token");
      expect(img.url).not.toContain("supabase.co");
      expect(img.url).not.toContain("?");
      expect(img.url.startsWith(`${SITE_IMAGE_DIR}/`)).toBe(true);
      expect(img.file).toBe(img.url);
    }
    // every referenced path is a file that really exists in the site
    for (const img of images) expect(files[img.url]).toBeDefined();
  });

  it("numbers same-purpose picks apart and keeps the purpose readable", async () => {
    const fetchImpl = vi.fn(async () => imageResponse(enc.encode("BYTES")));
    const { images } = await localizeImages(picks, fetchImpl as unknown as typeof fetch);
    expect(images.map((i) => i.url)).toEqual([
      "images/hero-1.jpg",
      "images/hero-2.jpg",
      "images/service-drains-1.jpg",
    ]);
  });

  it("is deterministic — a regeneration derives the identical paths", async () => {
    const fetchImpl = vi.fn(async () => imageResponse(enc.encode("BYTES")));
    const a = await localizeImages(picks, fetchImpl as unknown as typeof fetch);
    const b = await localizeImages(picks, fetchImpl as unknown as typeof fetch);
    expect(a.images.map((i) => i.url)).toEqual(b.images.map((i) => i.url));
  });

  it("drops a pick that cannot be fetched from BOTH the files and the prompt list", async () => {
    // A page must never reference a file that was not written.
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("bbb") ? new Response("nope", { status: 404 }) : imageResponse(enc.encode("BYTES")),
    );
    const { images, files, failures } = await localizeImages(picks, fetchImpl as unknown as typeof fetch);

    expect(images).toHaveLength(2);
    expect(Object.keys(files)).toHaveLength(2);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("Hero");
    expect(failures[0]).toContain("404");
    for (const img of images) expect(files[img.url]).toBeDefined();
  });

  it("refuses a non-image response rather than writing it into the site", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>login</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }));
    const { images, failures } = await localizeImages([picks[0]], fetchImpl as unknown as typeof fetch);
    expect(images).toHaveLength(0);
    expect(failures[0]).toContain("not an image");
  });

  it("never throws when the network itself fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const { images, files, failures } = await localizeImages(picks, fetchImpl as unknown as typeof fetch);
    expect(images).toEqual([]);
    expect(files).toEqual({});
    expect(failures).toHaveLength(3);
  });

  it("uses the response's content type for the extension", async () => {
    const fetchImpl = vi.fn(async () => imageResponse(enc.encode("BYTES"), "image/webp"));
    const { images } = await localizeImages([{ url: signed("aaa"), purpose: "Hero" }], fetchImpl as unknown as typeof fetch);
    expect(images[0].url).toBe("images/hero-1.webp");
  });

  it("handles no picks at all", async () => {
    const { images, files, failures } = await localizeImages([]);
    expect(images).toEqual([]);
    expect(files).toEqual({});
    expect(failures).toEqual([]);
  });
});
