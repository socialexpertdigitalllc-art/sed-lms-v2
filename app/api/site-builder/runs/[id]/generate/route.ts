import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { loadTemplateBundle } from "@/lib/site-builder/templates";
import { productionSiteBuildCall } from "@/lib/site-builder/generate";
import { runSite, buildBrief, outputPathFor, BUILDER_SITES_BUCKET, type PageState } from "@/lib/site-builder/run";
import type { SuppliedImage } from "@/lib/site-builder/prompt";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/** A "generating" run whose row hasn't moved for this long is presumed dead
 *  (server restart mid-generation) and may be claimed again. Progress writes
 *  land on every page-state change, so a LIVE generation touches its row far
 *  more often than this. */
const STALE_GENERATING_MS = 10 * 60 * 1000;

/**
 * Run the generation for a queued run, persisting per-page progress to the
 * row as it happens — the run screen polls the row and shows exactly which
 * pages are done, generating, or still pending (see `PageState.status`).
 *
 * Claimed by CAS on status ("queued" → "generating"), so the run screen and
 * a second tab can both fire this idempotently — one wins, the rest 409 and
 * simply keep polling. A stale "generating" run (see STALE_GENERATING_MS)
 * may be re-claimed the same way.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data: run, error: fetchErr } = await admin.from("builder_runs").select("*").eq("id", id).single();
  if (fetchErr || !run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const stale =
    run.status === "generating" &&
    Date.now() - new Date(run.updated_at as string).getTime() > STALE_GENERATING_MS;
  if (run.status !== "queued" && !stale) {
    return NextResponse.json({ error: `Cannot generate: this run is "${run.status}", not "queued".` }, { status: 409 });
  }

  const { data: claimed } = await admin
    .from("builder_runs")
    .update({ status: "generating", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", run.status)
    .eq("updated_at", run.updated_at as string)
    .select("*")
    .single();
  if (!claimed) {
    return NextResponse.json({ error: "Generation already started for this run." }, { status: 409 });
  }

  try {
    if (!run.lead_id) throw new Error("This run has no lead");
    const { data: lead } = await admin.from("leads").select("*").eq("id", run.lead_id).is("deleted_at", null).single();
    if (!lead) throw new Error("This run's lead no longer exists");

    const bundle = await loadTemplateBundle(admin, run.template_id as string);
    const brief = buildBrief(lead as Record<string, unknown>);
    const requestedPages = Array.isArray(lead.specify_pages) ? (lead.specify_pages as unknown[]).map(String) : [];
    const images = Array.isArray(run.images) ? (run.images as SuppliedImage[]) : [];

    // Progress writes are serialised on one promise chain: runSite's parallel
    // page tasks each await onProgress, and every write carries a fresh
    // snapshot, so the row's `pages` only ever moves forward. A failed write
    // is swallowed — losing one progress frame must never kill a generation.
    let chain: Promise<unknown> = Promise.resolve();
    const persist = (pages: Record<string, PageState>) => {
      const snapshot = JSON.parse(JSON.stringify(pages)) as Record<string, PageState>;
      chain = chain
        .then(() =>
          admin
            .from("builder_runs")
            .update({ pages: snapshot, updated_at: new Date().toISOString() })
            .eq("id", id),
        )
        .catch(() => {});
      return chain.then(() => {});
    };

    const result = await runSite({
      aiCall: productionSiteBuildCall,
      brief,
      images,
      template: bundle,
      requestedPages,
      onProgress: persist,
    });

    let outputPath: string | null = null;
    if (result.zipBytes) {
      outputPath = outputPathFor(id);
      const { error: upErr } = await admin.storage
        .from(BUILDER_SITES_BUCKET)
        .upload(outputPath, result.zipBytes, { contentType: "application/zip", upsert: true });
      if (upErr) throw new Error(`zip upload failed: ${upErr.message}`);
    }

    const { data: updated, error: updErr } = await admin
      .from("builder_runs")
      .update({
        status: result.ok ? "review" : "failed",
        pages: result.pages,
        output_path: outputPath,
        error: result.ok ? null : "Every page failed to generate.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();
    if (updErr || !updated) return NextResponse.json({ error: updErr?.message ?? "Update failed" }, { status: 400 });

    await admin.from("activity_log").insert({
      user_id: auth.userId,
      action: "site_builder.run.generated",
      entity_type: "builder_run",
      entity_id: id,
      new_value: { status: updated.status, pages: Object.keys(result.pages).length },
    });

    return NextResponse.json({ run: updated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Generation failed";
    await admin
      .from("builder_runs")
      .update({ status: "failed", error: message, updated_at: new Date().toISOString() })
      .eq("id", id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
