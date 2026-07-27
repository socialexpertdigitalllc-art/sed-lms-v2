import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { applyOperatorEdit } from "@/lib/site-studio/run/applyWritten";
import { loadManifest } from "@/lib/site-studio/run/engine";
import { contentDocSchema, type ContentDoc } from "@/lib/site-studio/schema";
import { isEditable, type SlotImageState } from "@/lib/site-studio/run/types";
import { refreshFinalizedZip } from "@/lib/site-studio/run/engine";
import type { ImageCandidate, PickChoice } from "@/lib/site-studio/assets/types";
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
 * A parsed `key`, either shape documented on `annotate.ts`'s `SLOT_ATTR`
 * (the same constant `RunPreview.tsx`'s own `parseSlotKey` parses — kept as
 * a separate, duplicated parser here rather than importing from a "use
 * client" component into a server route):
 *  - plain page-level:  `"${docPageIndex}:${slotId}"`
 *  - repeat row (4c):   `"${docPageIndex}:${repeatId}#${rowIndex}:${slotId}"`
 * `repeat` is set only for the second shape — `#` never appears in the
 * first, which is exactly what lets a caller tell them apart before parsing
 * either one further.
 */
interface ParsedImageKey {
  pageIndex: number;
  slotId: string;
  repeat?: { repeatId: string; rowIndex: number };
}

function parseImageKey(key: string): ParsedImageKey | null {
  const firstColon = key.indexOf(":");
  if (firstColon === -1) return null;
  const pageIndex = Number(key.slice(0, firstColon));
  if (!Number.isInteger(pageIndex) || pageIndex < 0) return null;
  const rest = key.slice(firstColon + 1);
  const hashIdx = rest.indexOf("#");
  if (hashIdx === -1) {
    if (!rest) return null;
    return { pageIndex, slotId: rest };
  }
  const repeatId = rest.slice(0, hashIdx);
  const afterHash = rest.slice(hashIdx + 1); // "${rowIndex}:${slotId}"
  const secondColon = afterHash.indexOf(":");
  if (!repeatId || secondColon === -1) return null;
  const rowIndex = Number(afterHash.slice(0, secondColon));
  const slotId = afterHash.slice(secondColon + 1);
  if (!Number.isInteger(rowIndex) || rowIndex < 0 || !slotId) return null;
  return { pageIndex, slotId, repeat: { repeatId, rowIndex } };
}

/**
 * POST: pick an image for one slot. `key` is `"${docPageIndex}:${slotId}"`
 * for a page-level image slot, or `"${docPageIndex}:${repeatId}#${rowIndex}:
 * ${slotId}"` for a slot inside a repeat row (Phase 4c — gallery/card images
 * typically live in a repeat, and this is what makes them pickable at all;
 * see `parseImageKey` above). Allowed at Gate 1 ("reviewing")
 * and Gate 2 ("ready") — `ImagePicker` is reachable from `RunPreview`, which
 * only mounts once a run is "ready", so this must accept that status too
 * (see `isEditable`'s own doc comment). A Gate 2 pick re-finalizes the zip
 * after persisting — see `refreshFinalizedZip`'s own doc comment.
 *
 * SECURITY: nothing in `choice` is trusted at face value, but the three
 * kinds are NOT held to the same check — each is checked against whatever
 * actually protects it, and those boundaries differ on purpose:
 *  - `library`: NOT checked against this slot's sourced candidates. A
 *    library asset's bytes already live in OUR bucket and its attribution
 *    is already ours (set at upload/rehost time) — there is no server-side
 *    fetch of caller-controlled input here, and nothing to forge. Candidate
 *    membership would only accomplish restricting an operator to images the
 *    server happened to think of for this exact slot, which is exactly what
 *    breaks the Upload tab (a freshly uploaded asset was never a candidate
 *    for any slot) and the Library-search tab (arbitrary search hits aren't
 *    candidates either) — both are legitimate, sighted picks of an asset the
 *    operator can already see and preview. The real, sufficient property is
 *    the CLIENT FENCE: a lead's own photo must never end up on another
 *    lead's site. That check (`kind='stock'` or `lead_id` = this run's lead)
 *    is the sole gate for this kind, so it fails CLOSED — any error loading
 *    the row, not just a missing one, is refused, never treated as "assume
 *    it's fine."
 *  - `pexels`: the opposite shape. The pexels id must match a `kind:"pexels"`
 *    candidate this slot was actually sourced with, and the URL/dimensions/
 *    photographer that get rehosted are the CANDIDATE's own stored values,
 *    never the request body's copies. This IS a server-side fetch of a URL
 *    (`rehostFromUrl`), so an unchecked body would let any caller hand it an
 *    arbitrary URL (SSRF) stored under fabricated attribution as a new
 *    SHARED stock asset — candidate matching is what closes that off.
 *  - `client`: `choice.url` must be an exact match against this run's own
 *    `client_photos` (captured at prepare time) — otherwise any URL could be
 *    fetched and stored as if it were this lead's own photo. Also a
 *    server-side fetch of a URL, so also checked against a server-known list
 *    rather than trusted at face value.
 *
 * Do not "helpfully" re-unify these into one shared check: `library` has no
 * SSRF and nothing forgeable to protect against, so candidate-membership
 * there is pure friction with no security payoff, while `pexels`/`client`
 * both gate an actual outbound fetch and need it.
 *
 * The target slot must also be declared `type:"image"` on that doc page in
 * the compiled manifest — a `key` naming a TEXT slot is refused (422) rather
 * than silently writing `asset:{uuid}` as literal visible copy (that value
 * is not itself markup/URL/token, so nothing else in the pipeline would ever
 * catch it: `contentDocSchema.tokenFree` only blocks `{{`-style tokens, and
 * `resolveAssets` only rewrites slots the manifest already says are images —
 * a text slot's `asset:` value would ship to the deployed site verbatim).
 * For a REPEAT-ROW key this same check runs against that REPEAT's declared
 * slots (`pageDef.repeats.find(r => r.id === repeatId).slots`, never the
 * page-level `pageDef.slots`) — manifest-authoritative the same way, never
 * shape-guessed from the value being written — and the row index is checked
 * against the doc's actual row count for that repeat (`docPage.repeats
 * [repeatId].length`), refusing an out-of-range row with 422 the same way an
 * unknown page index already does.
 *
 * Sourced candidates (`steps.images.slots[key]`, used below for the pexels
 * candidate-membership check and as the `subject` attributed to a fresh
 * rehost) exist ONLY for page-level slots today — `imageSource.ts`'s sourcing
 * pass walks `pageDef.slots`, never `pageDef.repeats` (repeat-row sourcing is
 * a separate piece of work this task doesn't cover). A repeat-row key is
 * therefore NOT required to have an entry there the way a flat key's 422
 * ("No sourced candidates for slot") still is — its query/candidates simply
 * default to empty, which correctly makes a pexels pick 422 (nothing was
 * ever offered as a candidate for that key) while leaving library, client-
 * photo, and upload picks fully usable, since none of those three depend on
 * a sourced candidate list at all.
 *
 * Only a `library` pick reuses an existing asset untouched (its `subject`
 * stays whatever the library already recorded); a `pexels` or `client` pick
 * REHOSTS a new asset, and per this phase's contract that new asset's
 * `subject` is forced to the slot's own recorded search `query`
 * (`steps.images.slots[key].query`) — NEVER whatever the client sent — so the
 * library warms up with the same text `searchLibrary` will actually match on
 * a future run. Writes `asset:{id}` into the doc slot via `applyOperatorEdit`
 * (provenance "operator" — an image pick is a human decision, and a later
 * re-roll must never silently replace it).
 */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as { key?: unknown; choice?: unknown } | null;
  if (!body || typeof body.key !== "string" || !body.choice || typeof body.choice !== "object") {
    return NextResponse.json({ error: "key and choice are required" }, { status: 422 });
  }
  const parsedKey = parseImageKey(body.key);
  if (!parsedKey) return NextResponse.json({ error: `Malformed slot key "${body.key}"` }, { status: 422 });
  const { pageIndex, slotId, repeat } = parsedKey;
  const choice = body.choice as PickChoice;
  if (choice.kind !== "library" && choice.kind !== "pexels" && choice.kind !== "client") {
    return NextResponse.json({ error: `choice.kind must be library, pexels, or client` }, { status: 422 });
  }

  const admin = createAdminClient();
  const { data: row, error: fetchErr } = await admin.from("studio_runs").select("*").eq("id", id).single();
  if (fetchErr || !row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Allowed at Gate 1 ("reviewing") and Gate 2 ("ready") — same discipline as
  // `/content`, `/theme`, `/revert`, and `/reroll` (see `isEditable`'s own
  // doc comment).
  if (!isEditable(row.status)) {
    return NextResponse.json({ error: `Cannot pick an image: this run is "${row.status}", not at a gate.` }, { status: 409 });
  }
  if (!row.content_doc) return NextResponse.json({ error: "This run has no content yet" }, { status: 422 });

  const doc = row.content_doc as ContentDoc;
  if (pageIndex < 0 || pageIndex >= doc.pages.length) {
    return NextResponse.json({ error: `page index ${pageIndex} out of range (doc has ${doc.pages.length} page(s))` }, { status: 422 });
  }

  // The target slot must be a declared IMAGE slot — never inferred from the
  // value being written, always from the manifest (see resolveAssets.ts's
  // own note on why that distinction matters). A repeat-row key is checked
  // against that REPEAT's own declared slots, and its row index against the
  // doc's actual row count for that repeat — never against page-level slots,
  // and never shape-guessed.
  const docPage = doc.pages[pageIndex];
  let manifest;
  try {
    manifest = await loadManifest(admin, row.template_id);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not load template" }, { status: 500 });
  }
  const pageDef = manifest.pages.find((p) => p.id === docPage.page_id);
  if (!pageDef) {
    return NextResponse.json({ error: `Page "${docPage.page_id}" is not in the template manifest` }, { status: 422 });
  }

  if (repeat) {
    const repeatDef = pageDef.repeats.find((r) => r.id === repeat.repeatId);
    if (!repeatDef) {
      return NextResponse.json({ error: `Repeat "${repeat.repeatId}" is not declared on this page` }, { status: 422 });
    }
    const rows = docPage.repeats[repeat.repeatId] ?? [];
    if (repeat.rowIndex >= rows.length) {
      return NextResponse.json(
        { error: `Row ${repeat.rowIndex} is out of range for repeat "${repeat.repeatId}" (it has ${rows.length} row(s))` },
        { status: 422 },
      );
    }
    const repeatSlotDef = repeatDef.slots.find((s) => s.id === slotId);
    if (!repeatSlotDef || repeatSlotDef.type !== "image") {
      return NextResponse.json(
        { error: `Slot "${slotId}" is not an image slot on repeat "${repeat.repeatId}"` },
        { status: 422 },
      );
    }
  } else {
    const slotDef = pageDef.slots.find((s) => s.id === slotId);
    if (!slotDef || slotDef.type !== "image") {
      return NextResponse.json({ error: `Slot "${slotId}" is not an image slot on this page` }, { status: 422 });
    }
  }

  // Sourced candidates exist only for page-level slots today (see the route
  // doc comment above) — required for a flat key (unchanged 422), but merely
  // optional for a repeat-row key: its query/candidates default to empty
  // rather than refusing the whole pick, so library/client/upload picks stay
  // usable even though nothing was ever sourced for that exact row.
  const slotState = ((row.steps?.images?.slots ?? {}) as Record<string, SlotImageState>)[body.key];
  if (!repeat && !slotState) {
    return NextResponse.json({ error: `No sourced candidates for slot "${body.key}"` }, { status: 422 });
  }
  const slotQuery = slotState?.query ?? "";
  const candidates = slotState?.candidates ?? [];

  let assetId: string;
  if (choice.kind === "library") {
    // No candidate-membership check here — see the route doc comment above
    // for why that's the correct call for this kind specifically. The fence
    // is the ONLY gate, so it must fail closed: a query error is treated the
    // same as "not found," never silently let through.
    const { data: asset, error: assetErr } = await admin
      .from("studio_assets")
      .select("id,kind,lead_id")
      .eq("id", choice.asset_id)
      .single();
    if (assetErr || !asset) return NextResponse.json({ error: "Library asset not found" }, { status: 404 });
    const fenced = asset.kind === "stock" || asset.lead_id === row.lead_id;
    if (!fenced) {
      return NextResponse.json({ error: "This asset is not available to this run's lead" }, { status: 422 });
    }
    await bumpUseCount(admin, choice.asset_id);
    assetId = choice.asset_id;
  } else if (choice.kind === "pexels") {
    const candidateMatch = candidates.find(
      (c): c is Extract<ImageCandidate, { kind: "pexels" }> => c.kind === "pexels" && c.pexels_id === choice.pexels_id,
    );
    if (!candidateMatch) {
      return NextResponse.json({ error: "That Pexels photo was not offered as a candidate for this slot" }, { status: 422 });
    }
    // Rehost the CANDIDATE's own stored fields — never the request body's
    // copies. Trusting the body's `download_url` would let any caller hand
    // an arbitrary URL to a server-side fetch (SSRF) and have it stored as a
    // shared stock asset under fabricated dimensions/attribution.
    const result = await rehostFromUrl(admin, candidateMatch.download_url, {
      kind: "stock",
      subject: slotQuery,
      source: "pexels",
      pexels_id: candidateMatch.pexels_id,
      width: candidateMatch.width,
      height: candidateMatch.height,
      photographer: candidateMatch.photographer,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: rehostStatus(result.error) });
    assetId = result.asset.id;
  } else {
    if (!row.lead_id) {
      return NextResponse.json({ error: "This run has no lead to attribute a client photo to" }, { status: 422 });
    }
    const clientPhotos = Array.isArray(row.client_photos) ? (row.client_photos as string[]) : [];
    if (!clientPhotos.includes(choice.url)) {
      return NextResponse.json({ error: "That photo is not one of this lead's own client photos" }, { status: 422 });
    }
    const result = await rehostFromUrl(admin, choice.url, {
      kind: "client",
      lead_id: row.lead_id,
      subject: slotQuery,
      source: "client_link",
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: rehostStatus(result.error) });
    assetId = result.asset.id;
  }

  let merged;
  try {
    if (repeat) {
      // Row-aware, same shape `/content` PATCH's `repeats` body and
      // `applyOperatorEdit`'s own `OperatorEdit.repeats` already use —
      // touches exactly this one row's one slot, no sibling row or field.
      merged = applyOperatorEdit(doc, pageIndex, {
        repeats: { [repeat.repeatId]: { [String(repeat.rowIndex)]: { [slotId]: `asset:${assetId}` } } },
      });
    } else {
      // imageSlotIds: this route already confirmed `slotDef.type === "image"`
      // above — passing it stops applyOperatorEdit from backing up an image
      // slot's value at all (review fix, Phase 4a: an image slot's pre-pick
      // value is the template's own demo sample, never an AI-written value, so
      // backing it up would let a later revert reinstate a vendor stock photo
      // on a client's live site, mislabelled "ai").
      merged = applyOperatorEdit(doc, pageIndex, { slots: { [slotId]: `asset:${assetId}` } }, new Set([slotId]));
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid pick" }, { status: 422 });
  }
  const check = contentDocSchema.safeParse(merged);
  if (!check.success) {
    return NextResponse.json({ error: `Pick rejected: ${check.error.issues[0]?.message ?? "invalid content"}` }, { status: 422 });
  }

  // CAS on `updated_at` (the same shape the engine's own `persistRun`/
  // `claimRun` use, see engine.ts): a text edit and an image pick landing
  // near-simultaneously on the same run would otherwise silently drop
  // whichever one's read->merge->write finished last. Zero rows back means
  // someone else wrote this run since `row` was read — refuse rather than
  // overwrite, and tell the operator to redo the change against fresh state.
  const { data: updated, error } = await admin
    .from("studio_runs")
    .update({ content_doc: merged, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("updated_at", row.updated_at)
    .select("*")
    .single();
  if (error || !updated) {
    return NextResponse.json(
      { error: "This run changed while you were editing — your view has been refreshed, please redo that change" },
      { status: 409 },
    );
  }

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

  // Gate 2 pick (status "ready"): keep the deployable zip in sync — see
  // `refreshFinalizedZip`'s own doc comment (same discipline as `/content`).
  let warning: string | undefined;
  if (updated.status === "ready") {
    const refreshed = await refreshFinalizedZip(admin, id);
    if (!refreshed.ok) warning = refreshed.warning;
  }

  return NextResponse.json({ run: updated, asset_id: assetId, ...(warning ? { warning } : {}) });
}
