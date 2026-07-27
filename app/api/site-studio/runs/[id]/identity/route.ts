import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { isEditable } from "@/lib/site-studio/run/types";
import { contentDocSchema, type ContentDoc } from "@/lib/site-studio/schema";
import { DISALLOWED } from "@/lib/site-studio/run/writer";
import { refreshFinalizedZip } from "@/lib/site-studio/run/engine";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Identity keys whose value legitimately IS a URL (or URL-shaped href):
 * `logo`/`map_embed`/`profile_link` are plain URLs, `phone_href`/`email_href`
 * are `tel:`/`mailto:` hrefs the dossier itself derives in that shape. Every
 * OTHER identity key — including business_name/phone/email/year, and any
 * operator-facing fact `prepare` seeded blank for the operator to fill in at
 * Gate 1 (city, neighborhood, owner_name, ... — see run/engine.ts's
 * `runPrepare`) — is held to the SAME `DISALLOWED` bar (writer.ts) as any
 * other operator-typed text: no markup, no template tokens, no bare links.
 * Exactly these five keys are exempt from that check, and no others.
 */
const URL_SHAPED_IDENTITY_KEYS = new Set(["logo", "map_embed", "profile_link", "phone_href", "email_href"]);

/**
 * Operator-supplied identity facts (Phase 4b). `prepare` seeds every
 * identity key a compiled template references but the lead's dossier
 * couldn't supply as `""` (present, not omitted, so the renderer's own
 * completeness check stays satisfied) and lists them in `steps.prepare.
 * pending_identity` for Gate 1's "Site facts" panel. This route is how an
 * operator fills those in — or, for a value they later want to correct,
 * edits any OTHER identity key already present in the doc; it is not
 * restricted to only the pending set.
 *
 * Gated on `isEditable(status)` (`reviewing` or `ready`), exactly like
 * `content`/`theme` — Gate 1 is the primary use case, but Gate 2 must not be
 * refused either (an operator revisiting a `ready` run to fill in a fact
 * they skipped earlier is a normal edit, not a special case).
 *
 * ONLY KEYS ALREADY PRESENT in `content_doc.identity` may be set — an
 * unknown key is rejected with 422 rather than silently accepted, which
 * would otherwise let a caller inject an identity key the compiled template
 * never declared (and the renderer would never read).
 *
 * A Gate 2 edit (status "ready") re-finalizes the deployable zip afterwards,
 * via `refreshFinalizedZip`, exactly like `content`/`theme` — see that
 * function's own doc comment for why.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as { identity?: unknown } | null;
  if (!body || typeof body.identity !== "object" || body.identity === null || Array.isArray(body.identity)) {
    return NextResponse.json({ error: "identity (an object of key -> string) is required" }, { status: 422 });
  }
  const entries = Object.entries(body.identity as Record<string, unknown>);
  if (entries.length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 422 });

  const badType = entries.find(([, v]) => typeof v !== "string");
  if (badType) {
    return NextResponse.json({ error: `identity key "${badType[0]}" must be a string` }, { status: 422 });
  }
  const values = Object.fromEntries(entries) as Record<string, string>;

  const admin = createAdminClient();
  const { data: row, error: fetchErr } = await admin.from("studio_runs").select("*").eq("id", id).single();
  if (fetchErr || !row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isEditable(row.status)) {
    return NextResponse.json({ error: `Cannot edit identity: this run is "${row.status}", not at a gate.` }, { status: 409 });
  }
  if (!row.content_doc) return NextResponse.json({ error: "This run has no content yet" }, { status: 422 });

  const doc = row.content_doc as ContentDoc;
  const unknownKey = Object.keys(values).find((key) => !(key in doc.identity));
  if (unknownKey) {
    return NextResponse.json(
      { error: `identity key "${unknownKey}" is not one this run references` },
      { status: 422 },
    );
  }

  const badField = Object.entries(values).find(
    ([key, value]) => !URL_SHAPED_IDENTITY_KEYS.has(key) && DISALLOWED.test(value),
  );
  if (badField) {
    return NextResponse.json(
      { error: `identity key "${badField[0]}" contains markup, a URL, or token syntax, which isn't allowed` },
      { status: 422 },
    );
  }

  const merged: ContentDoc = { ...doc, identity: { ...doc.identity, ...values } };

  // Validation gate, same discipline as `/content`: this only checks the
  // renderer-facing shape stays valid — the value persisted below is
  // `merged` itself, never a parsed/stripped result.
  const check = contentDocSchema.safeParse(merged);
  if (!check.success) {
    return NextResponse.json({ error: `Edit rejected: ${check.error.issues[0]?.message ?? "invalid content"}` }, { status: 422 });
  }

  // CAS on `updated_at` — same shape as `/content`/`/theme` (see either
  // route's own comment): zero rows back means someone else wrote this run
  // since `row` was read; refuse rather than overwrite.
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

  // Gate 2 edit (status "ready"): keep the deployable zip in sync — see
  // `refreshFinalizedZip`'s own doc comment (same discipline as `/content`).
  let warning: string | undefined;
  if (updated.status === "ready") {
    const refreshed = await refreshFinalizedZip(admin, id);
    if (!refreshed.ok) warning = refreshed.warning;
  }

  return NextResponse.json({ run: updated, ...(warning ? { warning } : {}) });
}
