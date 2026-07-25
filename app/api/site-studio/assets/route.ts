import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { searchLibrary, insertAsset } from "@/lib/site-studio/assets/library";
import { STUDIO_ASSETS_BUCKET, probeImageDimensions } from "@/lib/site-studio/assets/rehost";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024;
const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

// `searchLibrary` (assets/library.ts) already fails CLOSED on a malformed
// `leadId` — returns no rows rather than widening the query — but that's a
// defense buried inside the fence itself. A caller sending a bad lead_id
// deserves to be TOLD, not handed a silently empty result that looks
// identical to "this lead just has no photos yet". Same UUID shape as the
// one enforced in library.ts.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET: library search — subject substring, kind filter, lead-fenced when
 *  `lead_id` is supplied — with short-lived signed thumb URLs (the bucket is
 *  private). */
export async function GET(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const url = new URL(req.url);
  const subject = url.searchParams.get("subject")?.trim() || undefined;
  const kindParam = url.searchParams.get("kind");
  const kinds = kindParam === "stock" || kindParam === "client" ? ([kindParam] as const) : undefined;
  const leadId = url.searchParams.get("lead_id")?.trim() || undefined;
  if (leadId && !UUID_RE.test(leadId)) {
    return NextResponse.json({ error: "lead_id must be a valid UUID" }, { status: 422 });
  }
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : undefined;

  const admin = createAdminClient();
  const rows = await searchLibrary(admin, { subject, kinds: kinds ? [...kinds] : undefined, leadId, limit });

  const signedByPath = new Map<string, string>();
  await Promise.all(
    rows.map(async (r) => {
      const { data } = await admin.storage.from(STUDIO_ASSETS_BUCKET).createSignedUrl(r.storage_path, 60 * 60);
      if (data?.signedUrl) signedByPath.set(r.storage_path, data.signedUrl);
    }),
  );

  return NextResponse.json({
    assets: rows.map((r) => ({ ...r, thumb_url: signedByPath.get(r.storage_path) ?? null })),
  });
}

/** POST: manual stock upload (the library management surface, and
 *  ImagePicker's "Upload" tab). Same content-type + size ceiling
 *  `rehostFromUrl` enforces on a rehosted pick, checked here directly since
 *  this path never goes through `rehostFromUrl` (there's no URL to
 *  download — the bytes are already in hand from the multipart body).
 *  Dimensions are probed via the same magic-bytes helper `rehostFromUrl`
 *  could use for a rehost (assets/rehost.ts); a probe failure degrades to
 *  0x0 rather than blocking the upload. */
export async function POST(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "A file is required" }, { status: 422 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "Only image files are accepted" }, { status: 422 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File must be 15MB or smaller" }, { status: 422 });
  const ext = EXT_BY_CONTENT_TYPE[file.type];
  if (!ext) return NextResponse.json({ error: `Unsupported image type "${file.type}"` }, { status: 422 });

  const subject = String(form.get("subject") ?? "").trim();
  const nicheTags = String(form.get("niche_tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const dims = probeImageDimensions(bytes, file.type);

  const admin = createAdminClient();
  const assetId = crypto.randomUUID();
  const storagePath = `${assetId}.${ext}`;

  const { error: uploadError } = await admin.storage.from(STUDIO_ASSETS_BUCKET).upload(storagePath, bytes, {
    contentType: file.type,
  });
  if (uploadError) return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });

  let asset;
  try {
    asset = await insertAsset(admin, {
      id: assetId,
      kind: "stock",
      lead_id: null,
      subject,
      niche_tags: nicheTags,
      width: dims?.width ?? 0,
      height: dims?.height ?? 0,
      source: "upload",
      pexels_id: null,
      photographer: null,
      storage_path: storagePath,
      content_type: file.type,
    });
  } catch (e) {
    await admin.storage.from(STUDIO_ASSETS_BUCKET).remove([storagePath]).catch(() => {});
    return NextResponse.json({ error: e instanceof Error ? e.message : "Insert failed" }, { status: 400 });
  }

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "studio.asset.uploaded",
    entity_type: "studio_asset",
    entity_id: asset.id,
    new_value: { subject, bytes: file.size },
  });

  return NextResponse.json({ asset }, { status: 201 });
}
