import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { searchPexels } from "@/lib/site-studio/assets/pexels";
import { STUDIO_ASSETS_BUCKET } from "@/lib/site-studio/assets/rehost";
import { deriveImageNeeds } from "@/lib/site-builder/imageNeeds";
import { sourceImagesForNeeds } from "@/lib/site-builder/imageSourcing";
import { buildBrief } from "@/lib/site-builder/run";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST: the automatic replacement for "the operator hunts for every image
 * themselves". Given a lead, derives what images the run needs (Hero, one
 * per service, About — see `imageNeeds.ts`) and sources candidates for all
 * of them in one call: library first, Pexels as a top-up, cheap filters
 * only, no vision AI, no ranking. The response is what the image step
 * renders directly — the operator arrives at an already-populated screen.
 *
 * Gallery images are NOT part of this route: the lead's own `image_links`
 * become Gallery candidates with no searching at all, handled entirely
 * client-side (see NewSiteFlow.tsx).
 */
export async function POST(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const body = (await req.json().catch(() => null)) as { lead_id?: unknown } | null;
  const leadId = typeof body?.lead_id === "string" ? body.lead_id : "";
  if (!leadId) return NextResponse.json({ error: "lead_id is required" }, { status: 422 });

  const admin = createAdminClient();

  const { data: lead, error: leadErr } = await admin
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .is("deleted_at", null)
    .single();
  if (leadErr || !lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const brief = buildBrief(lead as Record<string, unknown>);
  const { needs, servicesTruncated, droppedServices } = deriveImageNeeds(brief);
  const sourced = await sourceImagesForNeeds({ admin, searchPexels }, needs, leadId);

  // Library candidates carry a private-bucket storage path, not a URL a
  // browser can load — resolve every distinct one to a short-lived signed
  // URL in one batch (same pattern as GET /api/site-studio/assets).
  const paths = new Set<string>();
  for (const need of sourced) {
    for (const c of need.candidates) {
      if (c.kind === "library") paths.add(c.thumb_path);
    }
  }
  const signedByPath = new Map<string, string>();
  await Promise.all(
    [...paths].map(async (path) => {
      const { data } = await admin.storage.from(STUDIO_ASSETS_BUCKET).createSignedUrl(path, 60 * 60);
      if (data?.signedUrl) signedByPath.set(path, data.signedUrl);
    }),
  );

  const needsOut = sourced.map((need) => ({
    purpose: need.purpose,
    query: need.query,
    pexelsError: need.pexelsError,
    candidates: need.candidates.map((c) =>
      c.kind === "library"
        ? {
            kind: "library" as const,
            key: c.key,
            asset_id: c.asset_id,
            width: c.width,
            height: c.height,
            thumb_url: signedByPath.get(c.thumb_path) ?? null,
          }
        : {
            kind: "pexels" as const,
            key: c.key,
            pexels_id: c.pexels_id,
            download_url: c.download_url,
            width: c.width,
            height: c.height,
            photographer: c.photographer,
            thumb_url: c.thumb_url,
          },
    ),
  }));

  return NextResponse.json({ needs: needsOut, servicesTruncated, droppedServices });
}
