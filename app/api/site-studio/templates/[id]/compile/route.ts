import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { compileTemplate } from "@/lib/site-studio/compiler/compile";
import { STUDIO_BUCKET, sourcePath, savePackage } from "@/lib/site-studio/service/templates";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

/** Deterministic compile (idempotent; re-compiling bumps version). The zip is
 *  the immutable source of truth, so a re-run always starts from it. */
export async function POST(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data: row } = await admin.from("studio_templates").select("id,name,status,version,compiled_at").eq("id", id).single();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.status === "certified") {
    return NextResponse.json({ error: "Disable the template before re-compiling a certified package" }, { status: 409 });
  }

  const { data: zip, error: dlErr } = await admin.storage.from(STUDIO_BUCKET).download(sourcePath(id));
  if (dlErr || !zip) return NextResponse.json({ error: "Source zip missing" }, { status: 500 });

  let result;
  try {
    // compileTemplate throws on malformed/unsafe zips (see its @throws note)
    result = compileTemplate(new Uint8Array(await zip.arrayBuffer()), row.name);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Compile failed";
    await admin.from("studio_templates").update({
      status: "uploaded",
      diagnostics: [{ level: "blocker", code: "zip_invalid", message }],
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    return NextResponse.json({ error: message }, { status: 422 });
  }

  const version = row.compiled_at ? row.version + 1 : row.version;
  if (result.ok) {
    result.template.manifest.version = version;
    await savePackage(admin, id, result.template);
  }

  const { data: updated, error: upErr } = await admin.from("studio_templates").update({
    status: result.ok ? "needs_review" : "uploaded",
    version,
    manifest: result.ok ? result.template.manifest : null,
    diagnostics: result.diagnostics,
    compiled_at: new Date().toISOString(),
    // a re-compile invalidates prior enrichment — the package was rebuilt
    identity_enriched_at: null,
    semantics_enriched_at: null,
    updated_at: new Date().toISOString(),
  }).eq("id", id).select("*").single();
  if (upErr || !updated) return NextResponse.json({ error: upErr?.message ?? "Update failed" }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "studio.template.compiled",
    entity_type: "studio_template",
    entity_id: id,
    new_value: { ok: result.ok, version, blockers: result.diagnostics.filter((d) => d.level === "blocker").length },
  });

  return NextResponse.json({ template: updated, ok: result.ok });
}
