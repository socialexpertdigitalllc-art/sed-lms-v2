import type { SupabaseClient } from "@supabase/supabase-js";
import { loadTemplateBundle } from "@/lib/site-builder/templates";
import { productionSiteBuildCall } from "@/lib/site-builder/generate";
import {
  runSite,
  buildBrief,
  outputPathFor,
  BUILDER_SITES_BUCKET,
  // How long a quiet "generating" run may be presumed dead and re-claimed. It
  // is defined in lib/ because the DELETE handler in the runs route needs the
  // same number; see its docblock for the sizing.
  STALE_GENERATING_MS,
  retryablePages,
  allFailuresTerminal,
  type PageState,
  type RunSiteResult,
} from "@/lib/site-builder/run";
import { probeQuota } from "@/lib/ai-tools/providers/quota";
import { clearLive, recordOutput } from "@/lib/site-builder/liveProgress";
import type { SuppliedImage } from "@/lib/site-builder/prompt";

/**
 * The generation core, extracted from the /generate route so the operator
 * route and the background processor can share one implementation (both are
 * thin wrappers; the claim token makes double-kicks safe).
 *
 * Everything the route used to do lives here unchanged — the RESUMABLE/stale
 * gate, the claim CAS + `generation_id` stamping, the guarded progress chain,
 * terminal-write-before-upload, the release write — PLUS the retry-rounds
 * loop: instead of handing a retryable failure back to the operator after one
 * pass, the core re-runs the failed pages (via `resume`, so finished pages
 * cost nothing) with escalating waits, probes the provider's plan quota when
 * failures look like throttles, and PARKS the run (`status: "failed"` +
 * `resume_at`) when the wall will not move within this request's budget.
 */

type Row = Record<string, unknown>;

export type GenerateOutcome =
  /** Terminal write landed: `run.status` is "review" or "failed". */
  | { kind: "done"; run: Row }
  /** Parked: `run.status` is "failed" with `resume_at` set; the background
   *  processor (or the operator) resumes it at that time. */
  | { kind: "parked"; run: Row }
  /** Never claimed the run — 404 / 409, verbatim messages from the route. */
  | { kind: "refused"; status: number; error: string }
  /** Claimed, ran, but another actor (recover / stale reclaim) took the run
   *  mid-flight; this attempt's result was discarded. Maps to a 409. */
  | { kind: "superseded"; error: string };

/**
 * Statuses the core will claim. `failed` is here because retry IS this
 * routine: a failed run is re-claimed and, thanks to `resume` below, only the
 * pages that did not finish are regenerated. `review`/`approved`/`deployed`
 * are deliberately absent — those have a packaged zip, and the right tool for
 * changing one page there is the per-page regenerate route.
 */
const RESUMABLE = new Set(["queued", "failed"]);

const SUPERSEDED_MESSAGE =
  "This generation was superseded (the run was recovered or re-claimed); its result was discarded.";

/**
 * In-request ceiling on the rounds loop. Sized safely under the route's
 * `maxDuration` (3600s): when the loop cannot finish inside this, it PARKS
 * the run with a `resume_at` instead of being killed mid-write.
 */
const DEFAULT_BUDGET_MS = 45 * 60_000;

/** Escalating waits between rounds: 30s, 2m, 5m, then 10m capped. Always
 *  overridden upward by the largest vendor Retry-After seen in the round. */
const DEFAULT_WAITS_MS = [30_000, 120_000, 300_000, 600_000];

/**
 * A window is treated as exhausted when the vendor reports (nearly) nothing
 * left in it — under this many tokens cannot produce a page, so retrying
 * against it only burns attempts.
 */
const EXHAUSTED_TOKEN_FLOOR = 1_000;

/** The provider identity `probeQuota` needs for `site_build`'s CURRENT
 *  routing. Injectable so tests never touch the DB or crypto. */
export interface QuotaTarget {
  providerKey: string;
  credentials: Record<string, string> | null;
}

/**
 * Resolve `site_build`'s current provider and its raw credentials record.
 * `resolveTaskModelCached` knows the provider KEY but its spec carries only
 * the bare API key; `probeQuota` wants the credentials record, which only
 * `getAiProviderConfigs` (server-only, decrypted) has. Dynamic imports keep
 * the failure surface inside the try: quota awareness is an enhancement and
 * this lookup must NEVER fail a run — any problem degrades to "no probe".
 */
async function productionQuotaTarget(): Promise<QuotaTarget | null> {
  try {
    const [{ resolveTaskModelCached }, { getAiProviderConfigs }] = await Promise.all([
      import("@/lib/ai-tools/providers/run"),
      import("@/lib/ai-tools/providers/config"),
    ]);
    const resolved = await resolveTaskModelCached("site_build");
    const configs = await getAiProviderConfigs();
    const entry = configs.find((c) => c.key === resolved.providerKey);
    return { providerKey: resolved.providerKey, credentials: entry?.credentials ?? null };
  } catch {
    return null;
  }
}

export interface GenerateRunDeps {
  runSiteImpl?: typeof runSite;
  probeQuotaImpl?: typeof probeQuota;
  quotaTarget?: () => Promise<QuotaTarget | null>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** In-request ceiling on the rounds loop; default DEFAULT_BUDGET_MS. */
  budgetMs?: number;
  /** Escalation schedule between rounds; default DEFAULT_WAITS_MS. */
  waitsMs?: number[];
}

/**
 * Run the generation for a queued run — or RETRY a failed one — persisting
 * per-page progress to the row as it happens; the run screen polls the row and
 * shows exactly which pages are done, generating, or still pending (see
 * `PageState.status`).
 *
 * Claimed by CAS on status (see RESUMABLE, → "generating"), so the run screen
 * and a second tab can both fire this idempotently — one wins, the rest get
 * "refused" and simply keep polling. A stale "generating" run (see
 * STALE_GENERATING_MS) may be re-claimed the same way. Retry costs only what
 * actually failed: the run's stored `pages` go in as `resume`, so an
 * already-`ok` page is carried forward verbatim and never re-bought.
 *
 * The claim also stamps a `generation_id` (migration 0063) that every write
 * below filters on, so an attempt that gets superseded mid-flight discards
 * its own result instead of overwriting the winner's. See the comment on
 * `generationId` for why the claim CAS alone is not enough. The zip is
 * uploaded only AFTER this attempt's terminal write has proven it still owns
 * the run, so a superseded attempt cannot overwrite the winner's archive
 * either — the DB guard alone would not have stopped that, since the upload
 * path is shared by every attempt.
 *
 * THE ROUNDS LOOP. A single `runSite` pass can leave retryable failures (a
 * sustained 429, a timeout). Rather than hand those back to the operator,
 * the core loops: each round re-runs only what failed (finished pages ride
 * `resume` for free), waiting out the escalation schedule — or the vendor's
 * own Retry-After when it asked for longer — between rounds. The loop ends
 * when every page is ok (→ review), every remaining failure is terminal
 * (→ failed, with the real page errors — retrying cannot fix a bad key), or
 * the wait would blow the in-request budget (→ park). While waiting, the row
 * carries `resume_at` as a "next attempt at" marker (status stays
 * "generating"); every terminal/park write and the claim clear it.
 *
 * QUOTA-AWARE PACING. Before sleeping on a round with retryable failures the
 * core probes the provider's plan quota (`probeQuota`; MiniMax only today).
 * An exhausted window resetting within the budget shortens/extends the wait
 * to the actual reset; one resetting beyond it parks the run with
 * `resume_at` at the reset. The probe can never fail a run — any failure
 * anywhere in the lookup or probe falls back to the schedule.
 */
export async function generateRunNow(
  admin: SupabaseClient,
  runId: string,
  deps: GenerateRunDeps = {},
): Promise<GenerateOutcome> {
  const {
    runSiteImpl = runSite,
    probeQuotaImpl = probeQuota,
    quotaTarget = productionQuotaTarget,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
    budgetMs = DEFAULT_BUDGET_MS,
    waitsMs = DEFAULT_WAITS_MS,
  } = deps;
  const iso = () => new Date(now()).toISOString();

  const { data: run, error: fetchErr } = await admin.from("builder_runs").select("*").eq("id", runId).single();
  if (fetchErr || !run) return { kind: "refused", status: 404, error: "Not found" };

  const stale =
    run.status === "generating" && now() - new Date(run.updated_at as string).getTime() > STALE_GENERATING_MS;
  if (!RESUMABLE.has(run.status as string) && !stale) {
    return {
      kind: "refused",
      status: 409,
      error: `Cannot generate: this run is "${run.status}", not "queued" or "failed".`,
    };
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
   * `resume_at` is cleared for the same reason: a claim IS the resume, so a
   * parked run's "resumes at" annotation is stale the moment one lands.
   */
  const generationId = crypto.randomUUID();

  const { data: claimed } = await admin
    .from("builder_runs")
    .update({ status: "generating", generation_id: generationId, error: null, resume_at: null, updated_at: iso() })
    .eq("id", runId)
    .eq("status", run.status)
    .eq("updated_at", run.updated_at as string)
    .select("*")
    .single();
  if (!claimed) {
    return { kind: "refused", status: 409, error: "Generation already started for this run." };
  }

  // The claim starts the live-output feed CLEAN: whatever a previous attempt
  // streamed describes output this attempt is about to redo, and a stale tail
  // beside a fresh generation would be worse than no tail. Only after a WON
  // claim — a refused caller must not wipe the live attempt's feed.
  clearLive(runId);

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
            .update({ pages: snapshot, updated_at: iso() })
            .eq("id", runId)
            .eq("generation_id", generationId),
        )
        .catch(() => {});
      return chain.then(() => {});
    };

    /**
     * Park the run: released (`generation_id: null`) and `failed`, with
     * `resume_at` telling the background processor — and the run screen —
     * when generation continues. One guarded write, like every other: a
     * superseded attempt's park matches zero rows and is discarded.
     */
    let latestPages = (run.pages ?? {}) as Record<string, PageState>;
    const park = async (resumeAtIso: string, message: string): Promise<GenerateOutcome> => {
      const { data: parked } = await admin
        .from("builder_runs")
        .update({
          status: "failed",
          pages: latestPages,
          error: message,
          resume_at: resumeAtIso,
          generation_id: null,
          updated_at: iso(),
        })
        .eq("id", runId)
        .eq("generation_id", generationId)
        .select("*")
        .maybeSingle();
      if (!parked) return { kind: "superseded", error: SUPERSEDED_MESSAGE };
      return { kind: "parked", run: parked as Row };
    };

    /**
     * The exhausted quota window that matters for pacing: the one resetting
     * LAST — waiting out the 5-hour window helps nothing while the weekly one
     * is also empty. Null when nothing is known, for any reason at all: no
     * probe for this provider, unparseable body, thrown probe, failed
     * credential lookup. See `probeQuota`'s module doc — the caller always
     * has the escalation schedule to fall back to.
     */
    const exhaustedWindow = async (): Promise<{ label: string; resetAt: Date } | null> => {
      try {
        const target = await quotaTarget();
        if (!target) return null;
        const snapshot = await probeQuotaImpl(target.providerKey, target.credentials);
        if (!snapshot) return null;
        let worst: { label: string; resetAt: Date } | null = null;
        for (const w of snapshot.windows) {
          if (w.remainingTokens === undefined || w.remainingTokens >= EXHAUSTED_TOKEN_FLOOR) continue;
          if (!w.resetAt) continue;
          if (!worst || w.resetAt.getTime() > worst.resetAt.getTime()) worst = { label: w.label, resetAt: w.resetAt };
        }
        return worst;
      } catch {
        return null;
      }
    };

    // ---- the rounds loop ----
    const startedAt = now();
    let round = 0;
    let result: RunSiteResult;
    /** Set when the loop ended because every remaining failure is terminal —
     *  the terminal write then says "failed" with these real reasons. */
    let terminalError: string | null = null;

    for (;;) {
      result = await runSiteImpl({
        aiCall: productionSiteBuildCall,
        brief,
        images,
        template: bundle,
        requestedPages,
        onProgress: persist,
        // The live-output feed: every streamed delta of every page lands in
        // the in-memory registry the /live route reads. Passing the callback
        // is also what switches the model calls to streaming.
        onOutput: (file, delta) => recordOutput(runId, file, delta),
        // Retry, stale-reclaim, and every round after the first all land
        // here. Whatever a previous pass finished is carried through
        // untouched; only the rest is regenerated. On a first pass this is
        // the row's stored pages (`{}` on a first run).
        resume: latestPages,
      });
      latestPages = result.pages;

      const failed = Object.entries(result.pages).filter(([, p]) => p.status === "failed");
      // Every requested page ok — the review path.
      if (failed.length === 0) break;

      // Every remaining failure is terminal: another round cannot help, and
      // "Every page failed to generate." would hide the real, actionable
      // reason (a bad key, a retired model). Say what actually happened.
      if (allFailuresTerminal(result.pages)) {
        terminalError = failed.map(([file, p]) => `${file}: ${p.error ?? "failed"}`).join("; ");
        break;
      }

      // The escalation schedule, never undercutting the vendor's own ask.
      let wait = waitsMs[Math.min(round, waitsMs.length - 1)];
      for (const [, p] of failed) {
        if (p.retryAfterMs !== undefined && p.retryAfterMs > wait) wait = p.retryAfterMs;
      }

      // Quota-aware pacing: when retryable failures may be burning against an
      // exhausted plan window, wait for the ACTUAL reset — or park until it.
      if (retryablePages(result.pages).length > 0) {
        const exhausted = await exhaustedWindow();
        if (exhausted) {
          const untilReset = exhausted.resetAt.getTime() - now();
          if (untilReset <= budgetMs - (now() - startedAt)) {
            wait = Math.max(0, untilReset);
          } else {
            return await park(
              exhausted.resetAt.toISOString(),
              `Paused — ${exhausted.label} quota is exhausted; resumes automatically at ${exhausted.resetAt.toISOString()}.`,
            );
          }
        }
      }

      // The wait itself would blow the in-request ceiling — park instead of
      // being killed mid-write by the platform's own clock.
      if (now() - startedAt + wait > budgetMs) {
        const resumeAt = new Date(now() + wait).toISOString();
        return await park(resumeAt, `Paused — provider kept throttling; will retry automatically at ${resumeAt}.`);
      }

      // Next-attempt marker: the run screen reads `resume_at` on a still-
      // "generating" row as "next attempt at". Guarded and best-effort like a
      // progress frame — losing it must never kill a generation.
      try {
        await admin
          .from("builder_runs")
          .update({ resume_at: new Date(now() + wait).toISOString(), updated_at: iso() })
          .eq("id", runId)
          .eq("generation_id", generationId);
      } catch {
        /* a lost marker is cosmetic */
      }

      await sleep(wait);
      round += 1;
    }

    const outputPath = result.zipBytes ? outputPathFor(runId) : null;

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
        status: terminalError !== null ? "failed" : result.ok ? "review" : "failed",
        pages: result.pages,
        output_path: outputPath,
        error: terminalError ?? (result.ok ? null : "Every page failed to generate."),
        resume_at: null,
        updated_at: iso(),
      })
      .eq("id", runId)
      .eq("generation_id", generationId)
      .select("*")
      .maybeSingle();
    if (updErr) return { kind: "refused", status: 400, error: updErr.message };
    /**
     * Zero rows means this attempt was superseded while it was running —
     * /recover, or another attempt that won a stale reclaim, cleared the token
     * deliberately. Discard this result rather than clobber the state that
     * actor set, and return WITHOUT uploading: that early return is what keeps
     * a loser's bytes off the winner's archive.
     */
    if (!updated) return { kind: "superseded", error: SUPERSEDED_MESSAGE };

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
     *
     * …and it RESTORES the pre-attempt `output_path`. Step 1 wrote the new one
     * before the upload (deliberately — ownership is established before any
     * object-store side effect), so a failed upload would otherwise leave the
     * row pointing at an object that does not exist. The run screen renders
     * "Download zip" on `output_path` alone, so that link would 404. Restoring
     * rather than nulling is the point: a re-run whose upload fails still has
     * the PREVIOUS attempt's zip sitting at that path, and that one is real.
     */
    const { data: released } = await admin
      .from("builder_runs")
      .update(
        uploadError
          ? {
              generation_id: null,
              status: "failed",
              error: uploadError,
              output_path: (run.output_path as string | null) ?? null,
              updated_at: iso(),
            }
          : { generation_id: null, updated_at: iso() },
      )
      .eq("id", runId)
      .eq("generation_id", generationId)
      .select("*")
      .maybeSingle();
    // Superseded during packaging — same discard-don't-clobber rule as above.
    if (!released) return { kind: "superseded", error: SUPERSEDED_MESSAGE };
    if (uploadError) return { kind: "refused", status: 500, error: uploadError };

    return { kind: "done", run: released as Row };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Generation failed";
    // Guarded the same way as the terminal write: a superseded attempt must
    // not be able to mark the run failed either. If the token no longer
    // matches this update touches nothing, and the caller still gets its own
    // error back.
    await admin
      .from("builder_runs")
      .update({ status: "failed", error: message, generation_id: null, resume_at: null, updated_at: iso() })
      .eq("id", runId)
      .eq("generation_id", generationId);
    return { kind: "refused", status: 500, error: message };
  } finally {
    // Every exit of a claimed attempt — done, parked, superseded, refused
    // after claim, thrown — drops the live feed: the generation it described
    // is over, and the run screen must not keep showing a "live" tail for a
    // run that is no longer writing. ONE finally instead of a call per return
    // path, so no future exit path can forget it.
    clearLive(runId);
  }
}
