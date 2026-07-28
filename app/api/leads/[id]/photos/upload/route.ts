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
    .select("business_name, image_links")
    .eq("id", id)
    .single();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const { candidates } = await getCapture(id);
  const wanted = new Set(parsed.data.photoKeys);
  const chosen = candidates.filter((c) => wanted.has(c.photoKey));
  if (chosen.length === 0) return NextResponse.json({ error: "No matching candidates" }, { status: 422 });

  const hosts = await listImageHosts();
  const state = imageHostStateStore();
  const base = slug(lead.business_name as string);

  const uploaded: string[] = [];
  const failed: { photoKey: string; error: string }[] = [];

  // Sequential on purpose: the chain mutates shared host state (cooldowns,
  // disablement), and racing 30 uploads past an exhausted key would burn every
  // one of them before the first failure is recorded.
  for (const [i, candidate] of chosen.entries()) {
    // Already uploaded — idempotent, and never pay for the same photo twice.
    if (candidate.status === "uploaded" && candidate.hostedUrl) {
      uploaded.push(candidate.hostedUrl);
      continue;
    }

    // Claim it, or leave it to whoever already has it. Two operators with the
    // same lead open must not both spend host quota on the same photo.
    if (!(await claimCandidate(candidate.id))) continue;

    // A claim MUST be handed back if anything unwinds between here and the
    // markCandidate*/finally below — otherwise the row is stuck in
    // `uploading` forever: invisible to the picker and unclaimable by anyone.
    // This `finally` cannot save us from a platform-level kill (e.g. hitting
    // `maxDuration`), which is why `claimCandidate` itself also treats a
    // stale `uploading` row as reclaimable — this is the fast path, that is
    // the fallback.
    let settled = false;
    try {
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
    } finally {
      if (!settled) await releaseCandidate(candidate.id);
    }
  }

  // Derive image_links from the candidate rows rather than writing the
  // in-memory `uploaded` delta on top of the snapshot read at the top of this
  // request. Two concurrent uploads for DIFFERENT photos on the same lead
  // each start from that same stale snapshot; a plain append-and-write lets
  // whichever request writes second clobber the first request's additions
  // outright (last-write-wins). Re-reading both `image_links` and every
  // `hosted_url` already recorded for this lead right before the write means
  // each writer produces a superset of everything uploaded before its own
  // read, so concurrent writers converge instead of losing data. This does
  // NOT close the race — two writers can still interleave between this read
  // and their own write — a real fix needs an atomic array-append (e.g. a
  // Postgres function); that's out of scope here and this is the deliberate
  // trade-off in the meantime.
  if (uploaded.length > 0) {
    const [{ data: freshLead }, { candidates: freshCandidates }] = await Promise.all([
      admin.from("leads").select("image_links").eq("id", id).single(),
      getCapture(id),
    ]);
    const existing = Array.isArray(freshLead?.image_links) ? (freshLead.image_links as string[]) : [];
    const fromCandidates = freshCandidates
      .filter((c) => c.status === "uploaded" && c.hostedUrl)
      .map((c) => c.hostedUrl as string);
    const merged = Array.from(new Set([...existing, ...fromCandidates]));
    const { error } = await admin.from("leads").update({ image_links: merged }).eq("id", id);
    if (error) return NextResponse.json({ error: "Uploaded, but could not save the links" }, { status: 500 });
  }

  return NextResponse.json({ uploaded, failed });
}
