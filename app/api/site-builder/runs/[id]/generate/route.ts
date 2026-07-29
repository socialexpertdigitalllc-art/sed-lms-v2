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
 *
 * The claim also stamps a `generation_id` (migration 0063) that every write
 * below filters on, so an attempt that gets superseded mid-flight discards
 * its own result instead of overwriting the winner's. See the comment on
 * `generationId` for why the claim CAS alone is not enough. The zip is
 * uploaded only AFTER this attempt's terminal write has proven it still owns
 * the run, so a superseded attempt cannot overwrite the winner's archive
 * either — the DB guard alone would not have stopped that, since the upload
 * path is shared by every attempt.
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

  /**
   * The token that says "THIS attempt owns the run" (migration 0063).
   *
   * The CAS below only makes the CLAIM single-winner; it says nothing about
   * the several MINUTES of writes that follow it. A second attempt can still
   * claim this run legitimately — via the stale reclaim above (a paced run can
   * go ~21 minutes without touching its row) or, later, via the operator's
   * /recover — and two live attempts racing on one `pages` column, at double
   * the AI spend, would silently let whichever finishes LAST win.
   *
   * So every write from here on carries `.eq("generation_id", generationId)`.
   * A superseded attempt matches zero rows and DISCARDS its own result rather
   * than overwriting a state somebody else deliberately set. `error` is
   * cleared here because this attempt supersedes any previous failure's
   * message — leaving it would show a stale error beside a live generation.
   */
  const generationId = crypto.randomUUID();

  const { data: claimed } = await admin
    .from("builder_runs")
    .update({ status: "generating", generation_id: generationId, error: null, updated_at: new Date().toISOString() })
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
    // Guarded by `generation_id` like every other write here: once this
    // attempt is superseded its progress frames simply stop landing.
    let chain: Promise<unknown> = Promise.resolve();
    const persist = (pages: Record<string, PageState>) => {
      const snapshot = JSON.parse(JSON.stringify(pages)) as Record<string, PageState>;
      chain = chain
        .then(() =>
          admin
            .from("builder_runs")
            .update({ pages: snapshot, updated_at: new Date().toISOString() })
            .eq("id", id)
            .eq("generation_id", generationId),
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

    const outputPath = result.zipBytes ? outputPathFor(id) : null;

    /**
     * STEP 1 — the terminal write, guarded on the token this attempt claimed.
     *
     * This runs BEFORE the zip upload, and the order is the point. The upload
     * targets one path shared by every attempt at this run, with `upsert:
     * true`; done first, a superseded attempt would have its DB write
     * correctly discarded and STILL overwrite the winner's archive — leaving
     * the row saying "review" with the winner's `pages` while the object store
     * held the loser's zip, which can be missing pages that failed in that
     * attempt but succeeded in the winner's. So ownership is established
     * before any object-store side effect, not after.
     *
     * DELIBERATELY does not null `generation_id`: this attempt still owns the
     * run while it packages, which is what makes the intermediate state below
     * safe. Releasing here would also strand the run — step 3's guarded write
     * would then match nothing and the token would belong to no attempt.
     */
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
      .eq("generation_id", generationId)
      .select("*")
      .maybeSingle();
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });
    /**
     * Zero rows means this attempt was superseded while it was running —
     * /recover, or another attempt that won a stale reclaim, cleared the token
     * deliberately. Discard this result rather than clobber the state that
     * actor set, and return WITHOUT uploading: that early return is what keeps
     * a loser's bytes off the winner's archive.
     *
     * 409, not 500: nothing malfunctioned and the operator did not cause it.
     * This is a lost race with a decision somebody else made, which is exactly
     * what a conflict status is for — and it keeps this off the error paths
     * that page an operator about broken generations.
     */
    if (!updated) {
      return NextResponse.json(
        { error: "This generation was superseded (the run was recovered or re-claimed); its result was discarded." },
        { status: 409 },
      );
    }

    /**
     * STEP 2 — we own the run, so now package it.
     *
     * The row already says "review" while these bytes are not up yet. That
     * intermediate state is safe for exactly one reason, and it is the
     * non-obvious part of this ordering: we still hold `generation_id`, so no
     * other attempt can write to this row, upload to this path, or be claimed
     * in between. The window closes at step 3.
     */
    let uploadError: string | null = null;
    if (result.zipBytes && outputPath) {
      const { error: upErr } = await admin.storage
        .from(BUILDER_SITES_BUCKET)
        .upload(outputPath, result.zipBytes, { contentType: "application/zip", upsert: true });
      if (upErr) {
        // Worth spelling out, because it is true and it is cheap: `resume`
        // carries every already-`ok` page forward, so retrying after a
        // packaging failure makes NO model calls at all — it just re-zips
        // what is already stored and uploads again.
        uploadError =
          `The site generated successfully but packaging it failed (${upErr.message}). ` +
          `Retry this run to re-package it — every finished page is carried forward, so no AI calls are made and it costs nothing.`;
      }
    }

    /**
     * STEP 3 — release the run, guarded on the same token. Kept as its own
     * write (see step 1): nulling the token earlier would make this match
     * nothing. On a packaging failure this also flips the run to "failed" with
     * the retryable message, so the operator never sees a "review" run whose
     * download 404s.
     */
    const { data: released } = await admin
      .from("builder_runs")
      .update(
        uploadError
          ? { generation_id: null, status: "failed", error: uploadError, updated_at: new Date().toISOString() }
          : { generation_id: null, updated_at: new Date().toISOString() },
      )
      .eq("id", id)
      .eq("generation_id", generationId)
      .select("*")
      .maybeSingle();
    // Superseded during packaging — same discard-don't-clobber rule as above.
    if (!released) {
      return NextResponse.json(
        { error: "This generation was superseded (the run was recovered or re-claimed); its result was discarded." },
        { status: 409 },
      );
    }
    if (uploadError) return NextResponse.json({ error: uploadError }, { status: 500 });

    await admin.from("activity_log").insert({
      user_id: auth.userId,
      action: "site_builder.run.generated",
      entity_type: "builder_run",
      entity_id: id,
      new_value: { status: released.status, pages: Object.keys(result.pages).length },
    });

    return NextResponse.json({ run: released });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Generation failed";
    // Guarded the same way as the terminal write: a superseded attempt must
    // not be able to mark the run failed either. If the token no longer
    // matches this update touches nothing, and the caller still gets its own
    // error back.
    await admin
      .from("builder_runs")
      .update({ status: "failed", error: message, generation_id: null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("generation_id", generationId);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
