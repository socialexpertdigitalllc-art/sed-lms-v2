import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { bumpUseCount } from "@/lib/site-studio/assets/library";
import { rehostFromUrl, STUDIO_ASSETS_BUCKET } from "@/lib/site-studio/assets/rehost";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST: turn an operator's image pick — from the library, a Pexels search,
 * or one of the lead's own photos — into a durable URL ready to sit in a
 * Site Builder run's `images: [{url, purpose}]` array.
 *
 * Unlike Site Studio's own `POST /runs/[id]/images` (which writes an
 * `asset:{id}` reference into a slot, resolved to bytes only at render
 * time), Site Builder hands the AI — and, once deployed, the live site's own
 * HTML — a literal URL. That URL has to keep working for as long as the
 * deployed site is live, not just for this editing session, so a picked
 * image is signed for a very long time rather than the ~1 hour the library
 * search/thumbnail UI uses (`studio-assets` is a private bucket — see
 * 0054's migration — so a long-lived signed URL is the durable option that
 * needs no change to that bucket's ACL).
 */
const DURABLE_URL_TTL_SECONDS = 60 * 60 * 24 * 365 * 10; // 10 years

async function durableUrl(admin: SupabaseClient, storagePath: string): Promise<string> {
  const { data, error } = await admin.storage.from(STUDIO_ASSETS_BUCKET).createSignedUrl(storagePath, DURABLE_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "Could not sign a URL for this image");
  return data.signedUrl;
}

function rehostStatus(error: string): number {
  return /^download failed/i.test(error) ? 502 : 422;
}

/** Only ever used for a `kind:"pexels"` pick — restricting the fetched host
 *  to pexels.com is what closes the SSRF hole a raw client-supplied
 *  `download_url` would otherwise open. Site Studio's own analogous route
 *  instead checks the URL against a server-persisted per-slot candidate
 *  list; Site Builder has no such per-slot state (no manifest, no slots), so
 *  the equivalent protection is applied at the domain level here instead. */
function isPexelsHost(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().endsWith("pexels.com");
  } catch {
    return false;
  }
}

interface PickBody {
  kind?: unknown;
  lead_id?: unknown;
  asset_id?: unknown;
  url?: unknown;
  pexels?: {
    download_url?: unknown;
    subject?: unknown;
    pexels_id?: unknown;
    width?: unknown;
    height?: unknown;
    photographer?: unknown;
  };
}

export async function POST(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const body = (await req.json().catch(() => null)) as PickBody | null;
  const kind = body?.kind;
  if (kind !== "library" && kind !== "pexels" && kind !== "client") {
    return NextResponse.json({ error: "kind must be library, pexels, or client" }, { status: 422 });
  }

  const admin = createAdminClient();

  if (kind === "library") {
    const assetId = typeof body?.asset_id === "string" ? body.asset_id : "";
    if (!assetId) return NextResponse.json({ error: "asset_id is required" }, { status: 422 });
    const { data: asset, error } = await admin
      .from("studio_assets")
      .select("id,kind,lead_id,storage_path")
      .eq("id", assetId)
      .single();
    if (error || !asset) return NextResponse.json({ error: "Library asset not found" }, { status: 404 });
    const leadId = typeof body?.lead_id === "string" ? body.lead_id : null;
    const fenced = asset.kind === "stock" || asset.lead_id === leadId;
    if (!fenced) return NextResponse.json({ error: "This asset is not available to this lead" }, { status: 422 });
    await bumpUseCount(admin, assetId);
    try {
      return NextResponse.json({ url: await durableUrl(admin, asset.storage_path as string) });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Could not sign a URL" }, { status: 500 });
    }
  }

  if (kind === "pexels") {
    const p = body?.pexels;
    const downloadUrl = typeof p?.download_url === "string" ? p.download_url : "";
    if (!downloadUrl || !isPexelsHost(downloadUrl)) {
      return NextResponse.json({ error: "A valid Pexels download_url is required" }, { status: 422 });
    }
    const result = await rehostFromUrl(admin, downloadUrl, {
      kind: "stock",
      subject: typeof p?.subject === "string" ? p.subject : "",
      source: "pexels",
      pexels_id: typeof p?.pexels_id === "number" ? p.pexels_id : null,
      width: typeof p?.width === "number" ? p.width : undefined,
      height: typeof p?.height === "number" ? p.height : undefined,
      photographer: typeof p?.photographer === "string" ? p.photographer : null,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: rehostStatus(result.error) });
    try {
      return NextResponse.json({ url: await durableUrl(admin, result.asset.storage_path) });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Could not sign a URL" }, { status: 500 });
    }
  }

  // kind === "client"
  const leadId = typeof body?.lead_id === "string" ? body.lead_id : "";
  const photoUrl = typeof body?.url === "string" ? body.url : "";
  if (!leadId || !photoUrl) return NextResponse.json({ error: "lead_id and url are required" }, { status: 422 });
  const { data: lead, error: leadErr } = await admin.from("leads").select("image_links").eq("id", leadId).single();
  if (leadErr || !lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  const clientPhotos = Array.isArray(lead.image_links) ? (lead.image_links as string[]) : [];
  if (!clientPhotos.includes(photoUrl)) {
    return NextResponse.json({ error: "That photo is not one of this lead's own client photos" }, { status: 422 });
  }
  const result = await rehostFromUrl(admin, photoUrl, {
    kind: "client",
    lead_id: leadId,
    subject: "client photo",
    source: "client_link",
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: rehostStatus(result.error) });
  try {
    return NextResponse.json({ url: await durableUrl(admin, result.asset.storage_path) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not sign a URL" }, { status: 500 });
  }
}
