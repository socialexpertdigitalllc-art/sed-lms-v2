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
