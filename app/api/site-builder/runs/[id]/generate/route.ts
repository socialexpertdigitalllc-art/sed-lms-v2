import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { loadTemplateBundle } from "@/lib/site-builder/templates";
import { productionSiteBuildCall } from "@/lib/site-builder/generate";
import { runSite, buildBrief, outputPathFor, BUILDER_SITES_BUCKET, type PageState } from "@/lib/site-builder/run";
import type { SuppliedImage } from "@/lib/site-builder/prompt";

export const runtime = "nodejs";
/**
 * Generation is now PACED behind each provider's rate budget (see
 * lib/ai-tools/providers/gate.ts), so a site's pages no longer all dispatch at
 * once — they queue, and a throttled call additionally waits out its backoff.
 * A seven-call run against a low per-minute ceiling comfortably exceeds five
 * minutes, and the old 300s ceiling would have killed it mid-flight, leaving a
 * "generating" row nothing could recover.
 *
 * Self-hosted `next start` does not enforce this the way a serverless platform
 * does; it is raised anyway so the intent is explicit rather than incidental.
 * The run screen polls per-page progress throughout (see the `persist` chain
 * below), so a long run stays observable rather than looking hung.
 */
export const maxDuration = 3600;

type Ctx = { params: Promise<{ id: string }> };

/**
 * A "generating" run whose row hasn't moved for this long is presumed dead
 * (server restart mid-generation) and may be claimed again.
 *
 * RAISED WITH `maxDuration`, and it has to be. `persist` only fires on a
 * PAGE-STATE change, so the row's quiet period is the gap between the last
 * "generating" emit and the first page to finish — and pacing made that gap
 * long. Worst case for a single page: it can sit in the rate gate for up to
 * GATE_MAX_WAIT_MS (2 min) per attempt, and between attempts wait out a vendor
 * Retry-After capped at 60s, across MAX_ATTEMPTS (4) attempts, each of which
 * may then burn the 5-minute call timeout — call it 4x(2+1+5) minutes, about
 * 21 minutes with nothing written to the row. 60 minutes clears that with room
 * for a slower vendor, and still trips long before `maxDuration` (3600s) does.
 *
 * Sizing this too LOW is the dangerous direction: a second tab or a re-click
 * would pass the stale check, win a fresh CAS claim, and run a SECOND
 * concurrent `runSite` against the same throttled provider with two writers
 * racing on `pages`. Too high merely delays recovery from a real crash, which
 * the operator can already force by re-queuing the run.
 */
const STALE_GENERATING_MS = 60 * 60 * 1000;

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
