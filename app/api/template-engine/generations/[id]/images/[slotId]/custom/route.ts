import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { mergeCandidates, parseImageSlots, type ImageCandidate, type ImageSlot } from "@/lib/template-engine/imageSlots";
import { addCustomSelection, contentTypeIsImage, isHttpUrl, sizeIsSane } from "@/lib/template-engine/curation";

interface GenRow {
  id: string;
  lead_id: string;
  status: string;
  image_slots: unknown;
}

const customSchema = z.object({ url: z.string().url() });

const FETCH_TIMEOUT_MS = 8000;

/** Total size of a fetch response: prefer `Content-Range`'s `/total` (a ranged GET's `Content-Length` is only the partial chunk), else fall back to `Content-Length` (HEAD, or a server that ignored Range and sent the whole thing). */
function totalSizeFrom(res: Response): number | null {
  const range = res.headers.get("content-range"); // "bytes 0-1023/123456"
  const fromRange = range ? /\/(\d+)$/.exec(range) : null;
  if (fromRange) return Number(fromRange[1]);
  const len = res.headers.get("content-length");
  return len ? Number(len) : null;
}

/**
 * Server-side-verify a candidate custom url without downloading the whole
 * image: try HEAD first (cheap, gives the real total size); some hosts
 * reject HEAD, so fall back to a small ranged GET (still cheap, and a 206's
 * `Content-Range` still reports the true total size).
 */
async function verifyImageUrl(url: string): Promise<{ ok: true; contentType: string | null; size: number | null } | { ok: false; error: string }> {
  try {
    const head = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (head.ok) {
      return { ok: true, contentType: head.headers.get("content-type"), size: totalSizeFrom(head) };
    }
  } catch {
    // fall through to the ranged GET
  }
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-1023" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    // Headers arrive first regardless of body size; grab what we need, then
    // release the stream immediately. Most hosts honor the Range header
    // above and send back only ~1KB, but a host that ignores it sends the
    // WHOLE image — draining without reading it avoids holding that
    // connection open for a response we only ever inspect the headers of.
    const result = !res.ok && res.status !== 206
      ? { ok: false as const, error: `URL responded with HTTP ${res.status}` }
      : { ok: true as const, contentType: res.headers.get("content-type"), size: totalSizeFrom(res) };
    void res.body?.cancel().catch(() => {});
    return result;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach the URL" };
  }
}

/** Operator supplies their own image url outside the gathered candidates (e.g. a client-provided photo Pexels never had). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; slotId: string }> },
) {
  const { id, slotId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.generate")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = customSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }
  if (!isHttpUrl(parsed.data.url)) {
    return NextResponse.json({ error: "Only http/https image URLs are supported" }, { status: 422 });
  }

  const admin = createAdminClient();
  const { data: genRow } = await admin
    .from("template_generations")
    .select("id, lead_id, status, image_slots")
    .eq("id", id)
    .maybeSingle();
  if (!genRow) return NextResponse.json({ error: "Generation not found" }, { status: 404 });
  const gen = genRow as GenRow;

  // RLS-scoped lookup: a lead this user cannot see must 404, not curate (mirrors generate/route.ts).
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", gen.lead_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  if (gen.status !== "curating") {
    return NextResponse.json({ error: "Not in curation" }, { status: 409 });
  }

  const slots = parseImageSlots(gen.image_slots);
  const slot = slots.find((s) => s.id === slotId);
  if (!slot) return NextResponse.json({ error: "Slot not found" }, { status: 404 });

  const url = parsed.data.url;
  const verified = await verifyImageUrl(url);
  if (!verified.ok) {
    return NextResponse.json({ error: `Could not verify image URL: ${verified.error}` }, { status: 422 });
  }
  if (!contentTypeIsImage(verified.contentType)) {
    return NextResponse.json(
      { error: `URL does not point to an image (content-type: ${verified.contentType ?? "unknown"})` },
      { status: 422 },
    );
  }
  if (!sizeIsSane(verified.size)) {
    return NextResponse.json({ error: "Image is too large" }, { status: 422 });
  }

  const customCandidate: ImageCandidate = { url, thumb: url, source: "custom" };
  const updatedSlot: ImageSlot = {
    ...slot,
    candidates: mergeCandidates(slot.candidates, [customCandidate]),
    selected: addCustomSelection(slot.selected, url, slot.pick_max),
  };
  const updatedSlots = slots.map((s) => (s.id === slotId ? updatedSlot : s));

  const { error: updateErr } = await admin
    .from("template_generations")
    .update({ image_slots: updatedSlots, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 400 });

  return NextResponse.json({ slot: updatedSlot });
}
