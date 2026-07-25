import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { applyOperatorEdit } from "@/lib/site-studio/run/applyWritten";
import { contentDocSchema, type ContentDoc } from "@/lib/site-studio/schema";
import type { SlotImageState } from "@/lib/site-studio/run/types";
import type { PickChoice } from "@/lib/site-studio/assets/types";
import { bumpUseCount } from "@/lib/site-studio/assets/library";
import { rehostFromUrl, STUDIO_ASSETS_BUCKET } from "@/lib/site-studio/assets/rehost";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** GET: the run's sourced image candidates, plus short-lived signed thumb
 *  URLs for LIBRARY candidates — those live in the private studio-assets
 *  bucket, so the cockpit grid can't just hot-link `thumb_path`. Pexels
 *  candidates already carry a public `thumb_url` (nothing is rehosted until
 *  picked), so they pass through untouched. */
export async function GET(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data: run, error } = await admin.from("studio_runs").select("steps").eq("id", id).single();
  if (error || !run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const slots = (run.steps?.images?.slots ?? {}) as Record<string, SlotImageState>;

  const libraryPaths = new Set<string>();
  for (const slot of Object.values(slots)) {
    for (const c of slot.candidates) if (c.kind === "library") libraryPaths.add(c.thumb_path);
  }
  const signedByPath = new Map<string, string>();
  await Promise.all(
    [...libraryPaths].map(async (path) => {
      const { data } = await admin.storage.from(STUDIO_ASSETS_BUCKET).createSignedUrl(path, 60 * 60);
      if (data?.signedUrl) signedByPath.set(path, data.signedUrl);
    }),
  );

  const out: Record<string, unknown> = {};
  for (const [key, slot] of Object.entries(slots)) {
    out[key] = {
      ...slot,
      candidates: slot.candidates.map((c) =>
        c.kind === "library" ? { ...c, thumb_url: signedByPath.get(c.thumb_path) ?? null } : c,
      ),
    };
  }

  return NextResponse.json({ slots: out });
}

/** A rehost failure that never reached the network (bad content-type,
 *  oversized body) is the operator's choice being wrong — 422, pick another
 *  one. A failure that DID reach the network (a dead URL, a non-2xx
 *  response) is the source's fault, not the pick's — 502, matching the
 *  plan's "a pexels rehost failure is a 502" (the same reasoning applies to
 *  a dead client-photo link). `rehostFromUrl`'s own error strings are
 *  consistently prefixed "download failed" for exactly this class of
 *  failure (see rehost.ts). */
function rehostStatus(error: string): number {
  return /^download failed/i.test(error) ? 502 : 422;
}

/**
 * POST: pick an image for one slot. `key` is `"${docPageIndex}:${slotId}"`
 * (types.ts's `SlotImageState` doc comment). Only a `library` pick reuses an
 * existing asset untouched (its `subject` stays whatever the library already
 * recorded); a `pexels` or `client` pick REHOSTS a new asset, and per this
 * phase's contract that new asset's `subject` is forced to the slot's own
 * recorded search `query` (`steps.images.slots[key].query`) — NEVER whatever
 * the client happened to send — so the library warms up with the same text
 * `searchLibrary` will actually match against on a future run. Writes
 * `asset:{id}` into the doc slot via `applyOperatorEdit` (provenance
 * "operator" — an image pick is a human decision, and a later re-roll must
 * never silently replace it).
 */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as { key?: unknown; choice?: unknown } | null;
  if (!body || typeof body.key !== "string" || !body.choice || typeof body.choice !== "object") {
    return NextResponse.json({ error: "key and choice are required" }, { status: 422 });
  }
  const keyMatch = /^(\d+):(.+)$/.exec(body.key);
  if (!keyMatch) return NextResponse.json({ error: `Malformed slot key "${body.key}"` }, { status: 422 });
  const pageIndex = Number(keyMatch[1]);
  const slotId = keyMatch[2];
  const choice = body.choice as PickChoice;
  if (choice.kind !== "library" && choice.kind !== "pexels" && choice.kind !== "client") {
    return NextResponse.json({ error: `choice.kind must be library, pexels, or client` }, { status: 422 });
  }

  const admin = createAdminClient();
  const { data: row, error: fetchErr } = await admin.from("studio_runs").select("*").eq("id", id).single();
  if (fetchErr || !row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.status !== "reviewing") {
    return NextResponse.json({ error: `Cannot pick an image: this run is "${row.status}", not at the gate.` }, { status: 409 });
  }
  if (!row.content_doc) return NextResponse.json({ error: "This run has no content yet" }, { status: 422 });

  const doc = row.content_doc as ContentDoc;
  if (pageIndex < 0 || pageIndex >= doc.pages.length) {
    return NextResponse.json({ error: `page index ${pageIndex} out of range (doc has ${doc.pages.length} page(s))` }, { status: 422 });
  }

  const slotQuery = ((row.steps?.images?.slots ?? {}) as Record<string, SlotImageState>)[body.key]?.query;

  let assetId: string;
  if (choice.kind === "library") {
    const { data: asset } = await admin.from("studio_assets").select("id").eq("id", choice.asset_id).single();
    if (!asset) return NextResponse.json({ error: "Library asset not found" }, { status: 404 });
    await bumpUseCount(admin, choice.asset_id);
    assetId = choice.asset_id;
  } else if (choice.kind === "pexels") {
    const result = await rehostFromUrl(admin, choice.download_url, {
      kind: "stock",
      subject: slotQuery || choice.subject,
      source: "pexels",
      pexels_id: choice.pexels_id,
      width: choice.width,
      height: choice.height,
      photographer: choice.photographer,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: rehostStatus(result.error) });
    assetId = result.asset.id;
  } else {
    if (!row.lead_id) {
      return NextResponse.json({ error: "This run has no lead to attribute a client photo to" }, { status: 422 });
    }
    const result = await rehostFromUrl(admin, choice.url, {
      kind: "client",
      lead_id: row.lead_id,
      subject: slotQuery || choice.subject,
      source: "client_link",
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: rehostStatus(result.error) });
    assetId = result.asset.id;
  }

  let merged;
  try {
    merged = applyOperatorEdit(doc, pageIndex, { slots: { [slotId]: `asset:${assetId}` } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid pick" }, { status: 422 });
  }
  const check = contentDocSchema.safeParse(merged);
  if (!check.success) {
    return NextResponse.json({ error: `Pick rejected: ${check.error.issues[0]?.message ?? "invalid content"}` }, { status: 422 });
  }

  const { data: updated, error } = await admin
    .from("studio_runs")
    .update({ content_doc: merged, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !updated) return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });

  await admin.from("studio_run_events").insert({
    run_id: id,
    step: "images",
    level: "info",
    message: `picked ${choice.kind} image for slot "${body.key}"`,
    detail: { key: body.key, kind: choice.kind, asset_id: assetId },
  });
  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "studio.run.image_picked",
    entity_type: "studio_run",
    entity_id: id,
    new_value: { key: body.key, asset_id: assetId },
  });

  return NextResponse.json({ run: updated, asset_id: assetId });
}
