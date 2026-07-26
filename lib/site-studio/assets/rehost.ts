import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssetRow } from "./types";
import { insertAsset } from "./library";

export const STUDIO_ASSETS_BUCKET = "studio-assets";
const MAX_BYTES = 15 * 1024 * 1024;

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export interface RehostMeta {
  kind: "stock" | "client";
  lead_id?: string | null;
  subject: string;
  niche_tags?: string[];
  width?: number;
  height?: number;
  source: "pexels" | "upload" | "client_link";
  pexels_id?: number | null;
  photographer?: string | null;
}

export type RehostResult =
  | { ok: true; asset: AssetRow; reused: boolean }
  | { ok: false; error: string };

export interface ProbedDimensions {
  width: number;
  height: number;
}

/**
 * Cheap, dependency-free dimension probe via magic bytes — enough for the
 * asset upload route (Task 9) to store real width/height without pulling in
 * an image-decoding library. Covers exactly the three content types this
 * pipeline accepts (see EXT_BY_CONTENT_TYPE above): PNG (the IHDR chunk is
 * always first, at a fixed offset), JPEG (scans marker segments for the
 * first SOFn frame header), WEBP (VP8/VP8L/VP8X — the three RIFF
 * sub-formats a browser or export tool actually produces). Returns null on
 * anything malformed, truncated, or unrecognised rather than throwing — a
 * dimension probe failing must never block an otherwise-valid upload; the
 * caller falls back to 0x0 dimensions, which is honest ("we don't know"),
 * not wrong.
 */
export function probeImageDimensions(bytes: Uint8Array, contentType: string): ProbedDimensions | null {
  try {
    if (contentType === "image/png") return probePng(bytes);
    if (contentType === "image/jpeg") return probeJpeg(bytes);
    if (contentType === "image/webp") return probeWebp(bytes);
    return null;
  } catch {
    return null;
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function probePng(bytes: Uint8Array): ProbedDimensions | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  // IHDR is always the very first chunk: length(4) + "IHDR"(4) + width(4, BE) + height(4, BE) at offset 8.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return width > 0 && height > 0 ? { width, height } : null;
}

function probeJpeg(bytes: Uint8Array): ProbedDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset++; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xff) { offset++; continue; } // fill byte before the real marker
    // Standalone markers carry no length field: SOI/EOI and the RSTn range.
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (offset + 4 > bytes.length) return null;
    const length = view.getUint16(offset + 2, false);
    // SOFn frame headers, excluding the DHT/JPG/DAC markers that share the
    // 0xC0-0xCF range but are not start-of-frame segments.
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      if (offset + 9 > bytes.length) return null;
      const height = view.getUint16(offset + 5, false);
      const width = view.getUint16(offset + 7, false);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += 2 + length;
  }
  return null;
}

function readAscii(bytes: Uint8Array, offset: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[offset + i]);
  return s;
}

function probeWebp(bytes: Uint8Array): ProbedDimensions | null {
  if (bytes.length < 30) return null;
  if (readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WEBP") return null;
  const fourCC = readAscii(bytes, 12, 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (fourCC === "VP8X") {
    // chunk data (offset 20): flags(1) + reserved(3) + (width-1)(3, LE) + (height-1)(3, LE)
    const width = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1;
    const height = (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1;
    return { width, height };
  }
  if (fourCC === "VP8 ") {
    // chunk data (offset 20): 3-byte frame tag, then the VP8 start code 0x9d 0x01 0x2a,
    // then width/height as 14-bit little-endian fields.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    const width = view.getUint16(26, true) & 0x3fff;
    const height = view.getUint16(28, true) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (fourCC === "VP8L") {
    // chunk data (offset 20): signature byte 0x2f, then a 28-bit packed
    // little-endian field: 14 bits (width-1) followed by 14 bits (height-1).
    if (bytes[20] !== 0x2f) return null;
    const packed = view.getUint32(21, true);
    const width = (packed & 0x3fff) + 1;
    const height = ((packed >> 14) & 0x3fff) + 1;
    return { width, height };
  }
  return null;
}

/** Reads a response body without ever buffering more than `maxBytes` in
 *  memory. Content-Length is checked FIRST — a declared size over the cap
 *  refuses before touching the body at all. When the body is streamable
 *  (the normal case), bytes are accumulated with a running counter and the
 *  read is aborted the instant the count exceeds the cap — a bad
 *  Content-Length (or none at all) can't force the whole body into memory
 *  first. Falls back to `arrayBuffer()` only when there's no stream to read
 *  (some test/edge Response shapes). */
async function readBoundedBody(
  res: Response,
  maxBytes: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  const declaredLength = Number(res.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, error: `refused: Content-Length ${declaredLength} exceeds max ${maxBytes}` };
  }

  if (!res.body) {
    let buf: ArrayBuffer;
    try {
      buf = await res.arrayBuffer();
    } catch (e) {
      return { ok: false, error: `download failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    const bytes = new Uint8Array(buf);
    if (bytes.byteLength > maxBytes) {
      return { ok: false, error: `refused: file too large (${bytes.byteLength} bytes, max ${maxBytes})` };
    }
    return { ok: true, bytes };
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          return { ok: false, error: `refused: file too large (exceeded ${maxBytes} bytes while streaming)` };
        }
        chunks.push(value);
      }
    }
  } catch (e) {
    return { ok: false, error: `download failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/**
 * Downloads a URL and rehosts it into our own bucket + a `studio_assets` row
 * — the "never hot-link" rule (spec §8): a rotted third-party URL must never
 * be able to break a deployed client site. NEVER throws; every failure mode
 * (bad content type, oversized body, network error, storage failure) returns
 * `{ok:false}` so a bad pick just lets the operator try another one.
 *
 * The DB row is inserted ONLY after the bucket upload succeeds — no orphan
 * `studio_assets` rows referencing bytes that were never actually written.
 */
export async function rehostFromUrl(
  admin: SupabaseClient,
  url: string,
  meta: RehostMeta,
  fetchImpl: typeof fetch = fetch,
): Promise<RehostResult> {
  // Already in the library under this pexels_id: reuse it outright, no
  // download at all (re-picking the same stock photo for a second client).
  if (meta.pexels_id != null) {
    const { data: existing } = await admin
      .from("studio_assets")
      .select()
      .eq("pexels_id", meta.pexels_id)
      .maybeSingle();
    if (existing) return { ok: true, asset: existing as AssetRow, reused: true };
  }

  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch (e) {
    return { ok: false, error: `download failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!res.ok) return { ok: false, error: `download failed: HTTP ${res.status}` };

  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!contentType.startsWith("image/")) {
    return { ok: false, error: `refused: not an image (content-type "${contentType || "unknown"}")` };
  }
  const ext = EXT_BY_CONTENT_TYPE[contentType];
  if (!ext) return { ok: false, error: `refused: unsupported image type "${contentType}"` };

  const bodyResult = await readBoundedBody(res, MAX_BYTES);
  if (!bodyResult.ok) return { ok: false, error: bodyResult.error };
  const bytes = bodyResult.bytes;

  const assetId = crypto.randomUUID();
  const storagePath = `${assetId}.${ext}`;
  const { error: uploadError } = await admin.storage.from(STUDIO_ASSETS_BUCKET).upload(storagePath, bytes, {
    contentType,
  });
  if (uploadError) return { ok: false, error: `upload failed: ${uploadError.message}` };

  try {
    const asset = await insertAsset(admin, {
      id: assetId,
      kind: meta.kind,
      lead_id: meta.kind === "client" ? (meta.lead_id ?? null) : null,
      subject: meta.subject,
      niche_tags: meta.niche_tags ?? [],
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      source: meta.source,
      pexels_id: meta.pexels_id ?? null,
      photographer: meta.photographer ?? null,
      storage_path: storagePath,
      content_type: contentType,
    });

    // A concurrent caller may have committed the same pexels_id first while
    // WE were still downloading/uploading — insertAsset's 23505 path then
    // hands back THEIR row instead of ours. When that happens our own
    // just-uploaded bytes are a dead object nobody will ever reference;
    // clean them up (best-effort — a failed cleanup here is a harmless
    // orphan, never a correctness problem) and report reused:true, since the
    // asset returned genuinely was NOT freshly created by this call.
    if (asset.storage_path !== storagePath) {
      await admin.storage
        .from(STUDIO_ASSETS_BUCKET)
        .remove([storagePath])
        .catch(() => {});
      return { ok: true, asset, reused: true };
    }

    return { ok: true, asset, reused: false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
