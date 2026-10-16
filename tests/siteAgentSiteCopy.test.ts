// tests/siteAgentSiteCopy.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { slimSiteCopy, COPY_MAX_BYTES, SHRINK_MIN_BYTES, WEB_IMAGE_MAX_EDGE } from "@/lib/site-agent/siteCopy";
import { MAX_RESULT_BYTES } from "@/lib/site-agent/types";
import { unzipToMap, zipFromMap } from "@/lib/template-engine/zip";

const enc = (s: string) => new TextEncoder().encode(s);

/** A noisy photo (noise doesn't compress) — big enough to cross SHRINK_MIN_BYTES.
 *  PNGs use grayscale noise: still >1 MB lossless, but colour noise is the
 *  pathological worst case for palette quantization (30s+ per image). */
async function photo(width: number, height: number, format: "jpeg" | "png" | "webp"): Promise<Uint8Array> {
  const base = sharp({ create: { width, height, channels: 3, background: "#7a8b9c", noise: { type: "gaussian", mean: 128, sigma: 40 } } });
  const out = format === "png" ? base.grayscale().png() : format === "webp" ? base.webp({ quality: 100 }) : base.jpeg({ quality: 98 });
  return new Uint8Array(await out.toBuffer());
}

// Real encodes of noisy multi-megapixel images — slower than the 5s default on a busy box.
describe("slimSiteCopy", { timeout: 30_000 }, () => {
  it("leaves a site with no big photos byte-for-byte alone (same zip back, no re-zip)", async () => {
    const small = await photo(300, 200, "jpeg");
    const zip = zipFromMap({ "index.html": enc("<img src='images/a.jpg'>"), "images/a.jpg": small });
    const out = await slimSiteCopy(zip);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.zip).toBe(zip);
    expect(out.resized).toEqual([]);
  });

  it("web-sizes an oversized JPEG at the SAME path and format, and leaves pages untouched", async () => {
    const big = await photo(2600, 1700, "jpeg");
    expect(big.byteLength).toBeGreaterThan(SHRINK_MIN_BYTES);
    const html = enc("<img src='images/hero.jpg'>");
    const out = await slimSiteCopy(zipFromMap({ "index.html": html, "images/hero.jpg": big }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const files = unzipToMap(out.zip);
    expect(Object.keys(files).sort()).toEqual(["images/hero.jpg", "index.html"]);
    expect(files["index.html"]).toEqual(html);
    const meta = await sharp(files["images/hero.jpg"]).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBe(WEB_IMAGE_MAX_EDGE);
    expect(out.resized).toEqual([{ path: "images/hero.jpg", before: big.byteLength, after: files["images/hero.jpg"].byteLength }]);
    expect(out.resized[0].after).toBeLessThan(out.resized[0].before);
  });

  it("keeps PNGs as PNG and WebPs as WebP — a page's src never points at a renamed file", async () => {
    const png = await photo(2200, 1000, "png");
    const webp = await photo(2600, 1700, "webp");
    expect(png.byteLength).toBeGreaterThan(SHRINK_MIN_BYTES);
    expect(webp.byteLength).toBeGreaterThan(SHRINK_MIN_BYTES);
    const out = await slimSiteCopy(zipFromMap({ "index.html": enc("x"), "a.png": png, "b.webp": webp }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const files = unzipToMap(out.zip);
    expect((await sharp(files["a.png"]).metadata()).format).toBe("png");
    expect((await sharp(files["b.webp"]).metadata()).format).toBe("webp");
    expect((await sharp(files["b.webp"]).metadata()).width).toBe(WEB_IMAGE_MAX_EDGE);
  });

  it("keeps a PNG's transparency through palette quantization (logos, cut-outs)", async () => {
    const cutout = new Uint8Array(await sharp(await photo(2200, 1000, "png")).ensureAlpha(0.5).png().toBuffer());
    expect(cutout.byteLength).toBeGreaterThan(SHRINK_MIN_BYTES);
    const out = await slimSiteCopy(zipFromMap({ "index.html": enc("x"), "logo.png": cutout }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.resized.map((r) => r.path)).toEqual(["logo.png"]);
    const meta = await sharp(unzipToMap(out.zip)["logo.png"]).metadata();
    expect(meta.format).toBe("png");
    expect(meta.hasAlpha).toBe(true);
  });

  it("leaves an unreadable '.jpg' as it was instead of failing the run", async () => {
    const junk = new Uint8Array(SHRINK_MIN_BYTES + 10).fill(7);
    const out = await slimSiteCopy(zipFromMap({ "index.html": enc("x"), "broken.jpg": junk }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(unzipToMap(out.zip)["broken.jpg"]).toEqual(junk);
    expect(out.resized).toEqual([]);
  });

  it("refuses a copy still over the limit, naming the biggest files first", async () => {
    const video = new Uint8Array(3 * 1024 * 1024).fill(1);
    const backup = new Uint8Array(2 * 1024 * 1024).fill(2);
    const zip = zipFromMap({ "index.html": enc("x"), "media/intro.mp4": video, "old-site.zip": backup });
    const out = await slimSiteCopy(zip, { maxBytes: 4 * 1024 * 1024 });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toMatch(/5\.0 MB even after shrinking/);
    expect(out.message).toMatch(/limit is 4\.0 MB/);
    expect(out.message.indexOf("media/intro.mp4 (3.0 MB)")).toBeLessThan(out.message.indexOf("old-site.zip (2.0 MB)"));
  });

  it("keeps the copy limit under the worker's edited-site cap, with room for the agent's additions", () => {
    expect(COPY_MAX_BYTES).toBeLessThan(MAX_RESULT_BYTES);
  });
});
