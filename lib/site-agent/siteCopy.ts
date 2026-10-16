// lib/site-agent/siteCopy.ts
import { unzipToMap, zipFromMap } from "@/lib/template-engine/zip";
import { MAX_RESULT_BYTES } from "./types";

/**
 * The site copy handed to the AI editor (agent-sites/{runId}/original.zip).
 *
 * Client docroots often carry camera-original photos (8–10 MB each). Zipped
 * whole, insideout.dmviral.com reached 111 MB on 2026-10-16 and every "Send
 * to AI" died at the storage upload ("The object exceeded the maximum allowed
 * size"). The worker caps the edited site at MAX_RESULT_BYTES anyway, so a
 * copy that big could never have been edited.
 *
 * Before upload, JPEG/PNG/WebP files over SHRINK_MIN_BYTES are resized to
 * WEB_IMAGE_MAX_EDGE and re-encoded in the SAME format at the SAME path, so
 * every page reference keeps working. PNGs are palette-quantized (TinyPNG
 * style, alpha kept): lossless PNG barely shrinks, and on that site's 82
 * photos lossless left the copy at 45.5 MB versus 35.0 MB quantized. A
 * re-encode is kept only when it is actually smaller. If the copy is still
 * over COPY_MAX_BYTES, the run is refused with the biggest files named,
 * instead of a storage error.
 *
 * Side effect, on purpose: approving a run deploys result.zip over the live
 * docroot (overrideLiveSite), so the live site ends up with the web-sized
 * photos too.
 */

/** Room under the worker's edited-site cap for whatever the agent adds. */
export const COPY_MAX_BYTES = MAX_RESULT_BYTES - 5 * 1024 * 1024;
export const WEB_IMAGE_MAX_EDGE = 1920;
export const SHRINK_MIN_BYTES = 1024 * 1024;

const SHRINKABLE = /\.(jpe?g|png|webp)$/i;

export interface ResizedImage { path: string; before: number; after: number }

export type SiteCopy =
  | { ok: true; zip: Uint8Array; totalBytes: number; resized: ResizedImage[] }
  | { ok: false; message: string; totalBytes: number };

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** Shrink oversized photos in an already prepareSiteZip'd site, then check
 *  the result fits. Never throws on a bad image — it is left as it was. */
export async function slimSiteCopy(zip: Uint8Array, opts: { maxBytes?: number } = {}): Promise<SiteCopy> {
  const maxBytes = opts.maxBytes ?? COPY_MAX_BYTES;
  const map = unzipToMap(zip);
  const resized: ResizedImage[] = [];

  const candidates = Object.keys(map).filter((p) => SHRINKABLE.test(p) && map[p].byteLength > SHRINK_MIN_BYTES);
  if (candidates.length) {
    // Loaded only when a site actually has big photos — most never do.
    const { default: sharp } = await import("sharp");
    const shrink = async (bytes: Uint8Array, path: string): Promise<Uint8Array | null> => {
      const img = sharp(bytes, { failOn: "none" });
      const meta = await img.metadata();
      if ((meta.pages ?? 1) > 1) return null; // animated WebP: leave alone
      const pipeline = img
        .rotate() // apply the camera's EXIF orientation before it is stripped
        .resize({ width: WEB_IMAGE_MAX_EDGE, height: WEB_IMAGE_MAX_EDGE, fit: "inside", withoutEnlargement: true });
      const ext = path.split(".").pop()!.toLowerCase();
      // Plain libjpeg-turbo, not mozjpeg: mozjpeg is several times slower per
      // photo, and a site can hand us 80+ of them inside one request.
      const encoded =
        ext === "png" ? pipeline.png({ palette: true, quality: 90, compressionLevel: 9 })
        : ext === "webp" ? pipeline.webp({ quality: 80 })
        : pipeline.jpeg({ quality: 82, progressive: true });
      return new Uint8Array(await encoded.toBuffer());
    };
    // One at a time: this runs on the shared prod box, inside the request.
    for (const path of candidates) {
      const before = map[path].byteLength;
      const out = await shrink(map[path], path).catch(() => null);
      if (out && out.byteLength < before) {
        map[path] = out;
        resized.push({ path, before, after: out.byteLength });
      }
    }
  }

  const totalBytes = Object.values(map).reduce((n, b) => n + b.byteLength, 0);
  if (totalBytes > maxBytes) {
    const biggest = Object.entries(map)
      .sort((a, b) => b[1].byteLength - a[1].byteLength)
      .slice(0, 5)
      .map(([path, bytes]) => `${path} (${mb(bytes.byteLength)})`)
      .join(", ");
    return {
      ok: false,
      totalBytes,
      message:
        `The site's files add up to ${mb(totalBytes)} even after shrinking its photos — the AI editor's limit is ` +
        `${mb(maxBytes)}. Largest files: ${biggest}. Remove or shrink these on the hosting, then send it again.`,
    };
  }
  // Nothing changed: hand back the caller's bytes rather than re-zipping.
  return { ok: true, zip: resized.length ? zipFromMap(map) : zip, totalBytes, resized };
}
