import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { runUploadChain } from "@/lib/photo-capture/hosts/chain";
import { imageHostStateStore, listImageHosts } from "@/lib/photo-capture/hosts/config";
import { imgbbAdapter } from "@/lib/photo-capture/hosts/imgbb";
import { imgchestAdapter } from "@/lib/photo-capture/hosts/imgchest";
import { postimagesAdapter } from "@/lib/photo-capture/hosts/postimages";
import type { HostProvider, UploadAdapter } from "@/lib/photo-capture/hosts/types";
import { isGooglePhotoSourceUrl } from "@/lib/photo-capture/googleLink";
import {
  claimCandidate,
  getCapture,
  markCandidateFailed,
  markCandidateUploaded,
  releaseCandidate,
} from "@/lib/photo-capture/store";

export const runtime = "nodejs";
export const maxDuration = 300;

const ADAPTERS: Record<HostProvider, UploadAdapter> = {
  imgbb: imgbbAdapter,
  postimages: postimagesAdapter,
  imgchest: imgchestAdapter,
};

const bodySchema = z.object({
  photoKeys: z.array(z.string().trim().min(1).max(256)).min(1).max(30),
});

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "business";
}

/**
 * Re-reads `image_links` immediately before writing and unions it with only
 * THIS request's newly uploaded URLs — never every `uploaded` candidate
 * recorded for the lead. An earlier version derived the merge from candidate
 * rows, which meant a photo the operator had manually removed from
 * `image_links` came back on the very next upload, because its candidate row
 * stayed `uploaded` forever with no way to record a durable removal.
 * Restricting the union to this request's own uploads fixes that, and — as a
 * side effect — narrows (rather than closes) the concurrency window down to
 * the gap between this read and this write, instead of the whole request. A
 * genuinely race-free append still needs an atomic Postgres operation; that
 * is out of scope here and this is the deliberate trade-off in the meantime.
 */
async function mergeNewImageLinks(
  admin: ReturnType<typeof createAdminClient>,
  leadId: string,
  newUrls: string[]
): Promise<void> {
  if (newUrls.length === 0) return;
  const { data: freshLead } = await admin.from("leads").select("image_links").eq("id", leadId).single();
  const existing = Array.isArray(freshLead?.image_links) ? (freshLead.image_links as string[]) : [];
  const merged = Array.from(new Set([...existing, ...newUrls]));
  const { error } = await admin.from("leads").update({ image_links: merged }).eq("id", leadId);
  if (error) throw new Error(error.message);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!perms.has("leads.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }

  const admin = createAdminClient();
  const { data: lead } = await admin
    .from("leads")
    .select("business_name, image_links, agent_id")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // Ownership scope (defense-in-depth mirror of the leads read policy): this
  // route uses the service-role admin client, which bypasses RLS entirely, so
  // it must re-check by hand what `read leads scoped` (0004_lead_scoping.sql)
  // would otherwise enforce. Matches app/api/leads/[id]/route.ts.
  if (!perms.has("leads.view_all") && lead.agent_id !== user.id) {
    return NextResponse.json({ error: "You can only modify your own leads." }, { status: 403 });
  }

  const uploaded: string[] = [];
  const failed: { photoKey: string; error: string }[] = [];

  try {
    const { candidates } = await getCapture(id);
    const wanted = new Set(parsed.data.photoKeys);
    const chosen = candidates.filter((c) => wanted.has(c.photoKey));
    if (chosen.length === 0) return NextResponse.json({ error: "No matching candidates" }, { status: 422 });

    const hosts = await listImageHosts();
    const state = imageHostStateStore();
    const base = slug(lead.business_name as string);

    // Sequential on purpose: the chain mutates shared host state (cooldowns,
    // disablement), and racing 30 uploads past an exhausted key would burn
    // every one of them before the first failure is recorded.
    for (const [i, candidate] of chosen.entries()) {
      // Already uploaded — idempotent, and never pay for the same photo twice.
      if (candidate.status === "uploaded" && candidate.hostedUrl) {
        uploaded.push(candidate.hostedUrl);
        continue;
      }

      // Claim it, or leave it to whoever already has it. Two operators with
      // the same lead open must not both spend host quota on the same photo.
      if (!(await claimCandidate(candidate.id))) continue;

      // A claim MUST be handed back if anything unwinds between here and the
      // markCandidate*/finally below — otherwise the row is stuck in
      // `uploading` forever: invisible to the picker and unclaimable by
      // anyone. This `finally` cannot save us from a platform-level kill
      // (e.g. hitting `maxDuration`), which is why `claimCandidate` itself
      // also treats a stale `uploading` row as reclaimable — this is the
      // fast path, that is the fallback.
      let settled = false;
      try {
        // The candidates route only checks this at write time. A stored
        // sourceUrl is handed straight to `fetch()` (for postimages/imgchest)
        // and to imgbb (which fetches server-side from whatever URL we give
        // it) — re-check here too, immediately before either happens, so a
        // row written before this guard existed (or altered any other way)
        // can never become an SSRF vector.
        if (!isGooglePhotoSourceUrl(candidate.sourceUrl)) {
          const message = "Source URL is not a Google-hosted photo";
          await markCandidateFailed(candidate.id, message);
          failed.push({ photoKey: candidate.photoKey, error: message });
          settled = true;
        } else {
          const filename = `${base}_${String(i + 1).padStart(3, "0")}.jpg`;
          const result = await runUploadChain(
            {
              url: candidate.sourceUrl,
              filename,
              fetchBytes: async () => {
                const r = await fetch(candidate.sourceUrl);
                if (!r.ok) throw new Error(`Could not fetch the source image (HTTP ${r.status})`);
                return Buffer.from(await r.arrayBuffer());
              },
            },
            { hosts, adapters: ADAPTERS, state }
          );

          if (result.directUrl) {
            await markCandidateUploaded(candidate.id, result.directUrl, result.provider ?? "");
            uploaded.push(result.directUrl);
          } else {
            const message = result.lastError ?? "Every image host refused this photo";
            await markCandidateFailed(candidate.id, message);
            failed.push({ photoKey: candidate.photoKey, error: message });
          }
          settled = true;
        }
      } finally {
        if (!settled) await releaseCandidate(candidate.id);
      }
    }

    if (uploaded.length > 0) {
      try {
        await mergeNewImageLinks(admin, id, uploaded);
      } catch (mergeError) {
        console.error(`[photo-capture] could not save image_links for lead ${id}:`, mergeError);
        return NextResponse.json(
          { error: "Uploaded, but could not save the links", uploaded, failed },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ uploaded, failed });
  } catch (e) {
    // Real host quota may already have been spent on whatever made it into
    // `uploaded` before this threw — a total 500 must not also strand that
    // paid-for work, so still attempt to persist it before reporting failure.
    console.error(`[photo-capture] upload POST failed for lead ${id}:`, e);
    if (uploaded.length > 0) {
      try {
        await mergeNewImageLinks(admin, id, uploaded);
      } catch (mergeError) {
        console.error(`[photo-capture] could not save partial image_links for lead ${id}:`, mergeError);
      }
    }
    return NextResponse.json({ error: "Photo capture is unavailable" }, { status: 500 });
  }
}
