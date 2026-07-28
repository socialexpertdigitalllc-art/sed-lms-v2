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
import { claimCandidate, getCapture, markCandidateFailed, markCandidateUploaded } from "@/lib/photo-capture/store";

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
  }

  // Append to the EXISTING field every downstream consumer already reads.
  if (uploaded.length > 0) {
    const existing = Array.isArray(lead.image_links) ? (lead.image_links as string[]) : [];
    const merged = [...existing, ...uploaded.filter((u) => !existing.includes(u))];
    const { error } = await admin.from("leads").update({ image_links: merged }).eq("id", id);
    if (error) return NextResponse.json({ error: "Uploaded, but could not save the links" }, { status: 500 });
  }

  return NextResponse.json({ uploaded, failed });
}
