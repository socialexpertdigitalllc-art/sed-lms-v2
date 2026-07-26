import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { isEditable } from "@/lib/site-studio/run/types";
import { loadManifest, refreshFinalizedZip } from "@/lib/site-studio/run/engine";
import { hexColor, type ContentDoc, type TemplateManifest } from "@/lib/site-studio/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** Live theme role editing. `roles` is a partial map — only the roles
 *  supplied are touched, merged into `content_doc.theme` (an operator
 *  recolouring `brand` leaves `accent` alone). Every value is checked
 *  against the SAME hex regex `contentDocSchema` itself enforces (imported,
 *  never re-derived — see schema.ts's `hexColor`), and every KEY must be a
 *  role the compiled template's manifest actually declares: a role the
 *  renderer's `applyTheme` (render/theme.ts) never consumes would otherwise
 *  be accepted, persisted, and silently do nothing — the same "why refuse
 *  instead of no-op" reasoning the images route's slot-type check documents.
 *  Allowed at Gate 1 ("reviewing") and Gate 2 ("ready"), same as `/content`
 *  (see `isEditable`'s own doc comment); refused for every other status. */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as { roles?: unknown } | null;
  if (!body || typeof body.roles !== "object" || body.roles === null || Array.isArray(body.roles)) {
    return NextResponse.json({ error: "roles (an object of role -> hex color) is required" }, { status: 422 });
  }
  const roles = body.roles as Record<string, unknown>;
  if (Object.keys(roles).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 422 });
  }

  const badHex = Object.entries(roles).find(([, value]) => typeof value !== "string" || !hexColor.safeParse(value).success);
  if (badHex) {
    return NextResponse.json({ error: `role "${badHex[0]}" is not a valid hex color` }, { status: 422 });
  }
  const values = roles as Record<string, string>;

  const admin = createAdminClient();
  const { data: row, error: fetchErr } = await admin.from("studio_runs").select("*").eq("id", id).single();
  if (fetchErr || !row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isEditable(row.status)) {
    return NextResponse.json({ error: `Cannot edit theme: this run is "${row.status}", not at a gate.` }, { status: 409 });
  }
  if (!row.content_doc) return NextResponse.json({ error: "This run has no content yet" }, { status: 422 });

  let manifest: TemplateManifest;
  try {
    manifest = await loadManifest(admin, row.template_id);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not load template" }, { status: 500 });
  }
  const undeclared = Object.keys(values).find((role) => !(role in manifest.theme.roles));
  if (undeclared) {
    return NextResponse.json({ error: `role "${undeclared}" is not declared by this template` }, { status: 422 });
  }

  const doc = row.content_doc as ContentDoc;
  const merged: ContentDoc = { ...doc, theme: { ...doc.theme, ...values } };

  // CAS on `updated_at` — same discipline as `/content` and `/images`: a
  // theme edit landing near-simultaneously with a content/image edit on the
  // same run must not silently clobber whichever finishes last. Zero rows
  // back means someone else wrote this run since `row` was read; refuse
  // rather than overwrite.
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
    step: "theme",
    level: "info",
    message: `updated theme role(s): ${Object.keys(values).join(", ")}`,
    detail: { roles: values },
  });
  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "studio.run.theme_updated",
    entity_type: "studio_run",
    entity_id: id,
    new_value: { roles: values },
  });

  // Gate 2 edit (status "ready"): keep the deployable zip in sync — see
  // `refreshFinalizedZip`'s own doc comment (same discipline as `/content`).
  let warning: string | undefined;
  if (updated.status === "ready") {
    const refreshed = await refreshFinalizedZip(admin, id);
    if (!refreshed.ok) warning = refreshed.warning;
  }

  return NextResponse.json({ run: updated, ...(warning ? { warning } : {}) });
}
