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

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    return { ok: false, error: `download failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (bytes.byteLength > MAX_BYTES) {
    return { ok: false, error: `refused: file too large (${bytes.byteLength} bytes, max ${MAX_BYTES})` };
  }

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
    return { ok: true, asset, reused: false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
