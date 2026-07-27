import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { loadTemplateBundle } from "@/lib/site-builder/templates";
import { productionSiteBuildCall } from "@/lib/site-builder/generate";
import { regeneratePage, buildBrief, assembleZip, outputPathFor, BUILDER_SITES_BUCKET, type PageState } from "@/lib/site-builder/run";
import type { SuppliedImage } from "@/lib/site-builder/prompt";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string; file: string }> };

/**
 * Regenerate exactly one page of an already-generated run, optionally
 * steered by an operator instruction. Runs only at "review" or "approved" —
 * the same "operator can still fix a page they dislike" window the plan
 * describes, kept open a little past approval since nothing has deployed
 * yet. Re-assembles and re-uploads the output zip afterward so the run's
 * `output_path` always reflects the latest per-page state.
 */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id, file: rawFile } = await ctx.params;
  const file = decodeURIComponent(rawFile);

  const body = (await req.json().catch(() => null)) as { instruction?: string } | null;
  const instruction = typeof body?.instruction === "string" ? body.instruction : undefined;

  const admin = createAdminClient();
  const { data: run, error: fetchErr } = await admin.from("builder_runs").select("*").eq("id", id).single();
  if (fetchErr || !run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (run.status !== "review" && run.status !== "approved") {
    return NextResponse.json(
      { error: `Cannot regenerate: this run is "${run.status}", not "review" or "approved".` },
      { status: 409 },
    );
  }

  const pages = (run.pages ?? {}) as Record<string, PageState>;
  const current = pages[file];
  if (!current) return NextResponse.json({ error: `Unknown page "${file}" for this run.` }, { status: 404 });

  if (!run.lead_id) return NextResponse.json({ error: "This run has no lead" }, { status: 422 });
  const { data: lead } = await admin.from("leads").select("*").eq("id", run.lead_id).single();
  if (!lead) return NextResponse.json({ error: "This run's lead no longer exists" }, { status: 422 });

  let bundle;
  try {
    bundle = await loadTemplateBundle(admin, run.template_id);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not load template" }, { status: 500 });
  }

  const brief = buildBrief(lead as Record<string, unknown>);
  const images = Array.isArray(run.images) ? (run.images as SuppliedImage[]) : [];
  const siteFiles = Object.keys(pages);

  const outcome = await regeneratePage({
    aiCall: productionSiteBuildCall,
    brief,
    images,
    template: bundle,
    siteFiles,
    file,
    kind: current.kind,
    name: current.name,
    instruction,
  });

  const newPages: Record<string, PageState> = {
    ...pages,
    [file]: outcome.ok
      ? { status: "ok", kind: current.kind, name: current.name, html: outcome.html }
      : { status: "failed", kind: current.kind, name: current.name, error: outcome.error },
  };

  const zipBytes = assembleZip(bundle.assets, newPages);
  const outputPath = outputPathFor(id);
  const { error: upErr } = await admin.storage
    .from(BUILDER_SITES_BUCKET)
    .upload(outputPath, zipBytes, { contentType: "application/zip", upsert: true });
  if (upErr) return NextResponse.json({ error: `zip upload failed: ${upErr.message}` }, { status: 500 });

  const { data: updated, error: updErr } = await admin
    .from("builder_runs")
    .update({ pages: newPages, output_path: outputPath, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (updErr || !updated) return NextResponse.json({ error: updErr?.message ?? "Update failed" }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "site_builder.page.regenerated",
    entity_type: "builder_run",
    entity_id: id,
    new_value: { file, ok: outcome.ok, instruction: instruction ?? null },
  });

  if (!outcome.ok) return NextResponse.json({ run: updated, error: outcome.error }, { status: 502 });
  return NextResponse.json({ run: updated });
}
