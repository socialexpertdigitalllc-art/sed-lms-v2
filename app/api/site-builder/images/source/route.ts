import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { searchPexels } from "@/lib/site-studio/assets/pexels";
import { STUDIO_ASSETS_BUCKET } from "@/lib/site-studio/assets/rehost";
import { deriveImageNeeds } from "@/lib/site-builder/imageNeeds";
import { sourceImages, type SourcedCandidate } from "@/lib/site-builder/imageSourcing";
import { rankByPeople } from "@/lib/site-builder/imageRank";
import { buildBrief } from "@/lib/site-builder/run";

export const runtime = "nodejs";
export const maxDuration = 60;

interface CandidateOut {
  kind: "library" | "pexels" | "client";
  key: string;
  thumb_url: string | null;
  width?: number;
  height?: number;
  asset_id?: string;
  pexels_id?: number;
  download_url?: string;
  photographer?: string;
  url?: string;
}

/** Vision-rank one row's candidates — people-free first — never blocking:
 *  `rankByPeople` itself swallows a failed/timed-out/unconfigured call and
 *  returns the input order unchanged (see lib/site-builder/imageRank.ts).
 *  Only candidates with a resolvable `thumb_url` are sent to the model; any
 *  without one (a library asset whose signed URL failed, say) are simply
 *  left where they were, appended after the ranked ones — never dropped. */
async function ranked(candidates: CandidateOut[]): Promise<CandidateOut[]> {
  const usable = candidates.filter((c): c is CandidateOut & { thumb_url: string } => !!c.thumb_url);
  if (usable.length < 2) return candidates;

  const order = await rankByPeople(usable.map((c) => ({ key: c.key, url: c.thumb_url })));
  const byKey = new Map(candidates.map((c) => [c.key, c]));
  const rankedOut: CandidateOut[] = [];
  for (const key of order) {
    const c = byKey.get(key);
    if (c) rankedOut.push(c);
  }
  const rankedKeys = new Set(order);
  for (const c of candidates) {
    if (!rankedKeys.has(c.key)) rankedOut.push(c);
  }
  return rankedOut;
}

function toOut(c: SourcedCandidate, signedByPath: Map<string, string>): CandidateOut {
  if (c.kind === "library") {
    return {
      kind: "library",
      key: c.key,
      asset_id: c.asset_id,
      width: c.width,
      height: c.height,
      thumb_url: signedByPath.get(c.thumb_path) ?? null,
    };
  }
  if (c.kind === "pexels") {
    return {
      kind: "pexels",
      key: c.key,
      pexels_id: c.pexels_id,
      download_url: c.download_url,
      width: c.width,
      height: c.height,
      photographer: c.photographer,
      thumb_url: c.thumb_url,
    };
  }
  return { kind: "client", key: c.key, url: c.url, thumb_url: c.url };
}

/**
 * POST: the automatic replacement for "the operator hunts for every image
 * themselves". Given a lead, derives the per-service search queries (see
 * `imageNeeds.ts`), sources and composes Hero + every Service row in one
 * pass (see `imageSourcing.ts#sourceImages` for the exact Hero composition),
 * then orders each row's candidates people-free first with one MiniMax
 * vision call per row (see `imageRank.ts`) — ranking only, nothing is ever
 * discarded, and a failed/unconfigured vision call just leaves a row's order
 * untouched. The response is what the image step renders directly — the
 * operator arrives at an already-populated screen.
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

  const leadRow = lead as Record<string, unknown>;
  const brief = buildBrief(leadRow);
  const clientPhotoUrls = Array.isArray(leadRow.image_links) ? (leadRow.image_links as string[]) : [];

  const needs = deriveImageNeeds(brief);
  const sourced = await sourceImages({ admin, searchPexels }, needs, leadId, clientPhotoUrls);

  // Library candidates carry a private-bucket storage path, not a URL a
  // browser can load — resolve every distinct one to a short-lived signed
  // URL in one batch (same pattern as GET /api/site-studio/assets).
  const paths = new Set<string>();
  for (const c of sourced.hero) if (c.kind === "library") paths.add(c.thumb_path);
  for (const row of sourced.services) for (const c of row.candidates) if (c.kind === "library") paths.add(c.thumb_path);

  const signedByPath = new Map<string, string>();
  await Promise.all(
    [...paths].map(async (path) => {
      const { data } = await admin.storage.from(STUDIO_ASSETS_BUCKET).createSignedUrl(path, 60 * 60);
      if (data?.signedUrl) signedByPath.set(path, data.signedUrl);
    }),
  );

  const hero = await ranked(sourced.hero.map((c) => toOut(c, signedByPath)));
  const services = await Promise.all(
    sourced.services.map(async (row) => ({
      service: row.service,
      purpose: row.purpose,
      query: row.query,
      pexelsError: row.pexelsError,
      candidates: await ranked(row.candidates.map((c) => toOut(c, signedByPath))),
    })),
  );

  return NextResponse.json({
    hero,
    services,
    servicesTruncated: sourced.servicesTruncated,
    droppedServices: sourced.droppedServices,
  });
}
