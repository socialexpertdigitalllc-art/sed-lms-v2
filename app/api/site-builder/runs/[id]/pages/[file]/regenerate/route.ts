import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { loadTemplateBundle } from "@/lib/site-builder/templates";
import { productionSiteBuildCall } from "@/lib/site-builder/generate";
import { regeneratePage, buildBrief, assembleZip, findComponentsFile, outputPathFor, BUILDER_SITES_BUCKET, type PageState } from "@/lib/site-builder/run";
import type { SuppliedImage } from "@/lib/site-builder/prompt";

export const runtime = "nodejs";
/** One page, but the same paced-and-retried AI call the full generation makes
 *  (see the sibling generate route). Up to 4 attempts at 300s each plus
 *  backoff does not fit in 120s — and a regeneration killed mid-flight leaves
 *  the operator staring at the failed page they were trying to replace. */
export const maxDuration = 900;

type Ctx = { params: Promise<{ id: string; file: string }> };

/**
 * Regenerate exactly one page of an already-generated run, optionally
 * steered by an operator instruction. Runs at "review" or "approved" — the
 * same "operator can still fix a page they dislike" window the plan
 * describes, kept open a little past approval since nothing has deployed
 * yet — and ALSO at "failed", where fixing one page is the whole point; such
 * a run is promoted back to "review" as soon as it has a real page again (see
 * `promoted` below). Re-assembles and re-uploads the output zip afterward, so
 * `output_path` names a real object — and if that upload fails on a run that
 * never had one, the path and the promotion are put back (see step 2).
 *
 * OWNERSHIP. A single-page write stands aside for EVERY other writer: it is
 * guarded on `generation_id IS NULL` (a whole-run generation claimed the run)
 * AND on the `updated_at` this request read (anything else moved the row —
 * another regeneration, a progress frame, /recover). Either way this result is
 * discarded with a 409 rather than overwriting a `pages` snapshot that is now
 * stale. This route takes no token of its own — it is one short write, not an
 * owner of the run, and giving it one would only raise the question of what a
 * generation should do when a regeneration holds it.
 *
 * The zip is uploaded only AFTER that write proves nobody took over, for the
 * same reason as in the generate route: every writer shares one upsert path,
 * so packaging first would let a correctly-refused write still clobber the
 * live generation's archive.
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

  // `failed` is here so an operator can fix the run that most needs fixing.
  // Without it the button renders on a failed page, shows its error, and does
  // nothing when clicked.
  const REGENERATABLE = new Set(["review", "approved", "failed"]);
  if (!REGENERATABLE.has(run.status as string)) {
    return NextResponse.json(
      { error: `Cannot regenerate: this run is "${run.status}", not "review", "approved" or "failed".` },
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
  // The site's PAGES — the components entry is not a page and must not
  // appear in "link only to these".
  const siteFiles = Object.keys(pages).filter((f) => pages[f].kind !== "component");

  // The run's current rewritten components file, as page-prompt context —
  // same context the original generation gave every page.
  const componentsEntry = Object.entries(pages).find(([, p]) => p.kind === "component");
  const components =
    componentsEntry && componentsEntry[1].status === "ok" && componentsEntry[1].html !== undefined
      ? { file: componentsEntry[0], source: componentsEntry[1].html }
      : undefined;

  const outcome = await regeneratePage({
    aiCall: productionSiteBuildCall,
    brief,
    images,
    template: bundle,
    siteFiles,
    file,
    kind: current.kind,
    name: current.name,
    components,
    instruction,
  });

  const newPages: Record<string, PageState> = {
    ...pages,
    [file]: outcome.ok
      ? { status: "ok", kind: current.kind, name: current.name, html: outcome.html }
      : { status: "failed", kind: current.kind, name: current.name, error: outcome.error },
  };

  // A failed run with a working page is reviewable. Leaving it `failed` would
  // mean the operator fixes a page and still cannot approve the run — the same
  // dead end this route was widened to escape. Only a REAL page counts: a
  // rewritten components file is not a site.
  const hasRealPage = Object.values(newPages).some((p) => p.status === "ok" && p.kind !== "component");
  const promoted = run.status === "failed" && hasRealPage;

  const outputPath = outputPathFor(id);

  /**
   * STEP 1 — the write, and it stands aside for ANY intervening writer.
   *
   * Everything above this point read the run MINUTES ago — a paced, retried
   * page call is why this route's maxDuration is 900 — and `newPages` is the
   * WHOLE pages blob rebuilt from that stale snapshot. Landing it blind would
   * revert every change made in the gap.
   *
   * Two guards, and both are load-bearing:
   *
   *  - `.is("generation_id", null)` stands aside for a whole-run generation.
   *    The operator can perfectly legitimately hit "Retry failed pages" ten
   *    seconds after starting this, which claims the run and stamps a token.
   *  - `.eq("updated_at", …)` is the optimistic CAS the sibling generate route
   *    already relies on, and it catches everything the token does not — most
   *    importantly ANOTHER REGENERATION. The mainline partial failure lands at
   *    "review", not "failed" (runSite calls a run ok when any real page
   *    succeeded), where per-page Retry is the only tool; two failed pages mean
   *    the operator can start two regenerations, both reading the same snapshot,
   *    and without this the second would revert the first's page and upload a
   *    zip without it. It also catches a progress frame, a terminal write, and
   *    /recover — every one of which bumps `updated_at`.
   *
   * This route deliberately takes NO token of its own (see the docblock): it
   * is one short write, not a multi-minute owner, and the asymmetry is the
   * point. A run whose process died between /generate's terminal write and its
   * release keeps a stale non-null token — typically at "review", since that
   * write sets the status and holds the token across the upload — and this
   * guard would then refuse every regeneration forever. That is precisely what
   * /recover clears: it accepts a dangling token on ANY status, not only
   * "generating", and leaves a "review" run at "review". So the guard has a
   * real escape hatch rather than being a trap.
   */
  const { data: updated, error: updErr } = await admin
    .from("builder_runs")
    .update({
      pages: newPages,
      output_path: outputPath,
      updated_at: new Date().toISOString(),
      ...(promoted ? { status: "review", error: null } : {}),
    })
    .eq("id", id)
    .eq("updated_at", run.updated_at as string)
    .is("generation_id", null)
    .select("*")
    .maybeSingle();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });
  if (!updated) {
    return NextResponse.json(
      {
        error:
          "This run changed while the page was being rewritten; the regenerated page was discarded. " +
          "Reload and try again.",
      },
      { status: 409 },
    );
  }

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "site_builder.page.regenerated",
    entity_type: "builder_run",
    entity_id: id,
    new_value: { file, ok: outcome.ok, instruction: instruction ?? null },
  });

  /**
   * STEP 2 — only now package, because we have proven nobody took over.
   *
   * Same ordering, and the same reason, as the sibling generate route: the zip
   * path is shared by every writer at this run and the upload upserts, so
   * uploading first would let a refused write STILL replace a live
   * generation's archive with a stale one.
   */
  // Same fallback runSite applies on assembly: an HTML components file that
  // is not currently "ok" ships as the template's original (it is a page
  // file, so it isn't in `assets`, and every generated page fetches it).
  const original = findComponentsFile(bundle);
  const baseAssets = { ...bundle.assets };
  if (original && bundle.pages[original.file] !== undefined && newPages[original.file]?.status !== "ok") {
    baseAssets[original.file] = new TextEncoder().encode(original.source);
  }

  const zipBytes = assembleZip(baseAssets, newPages);
  const { error: upErr } = await admin.storage
    .from(BUILDER_SITES_BUCKET)
    .upload(outputPath, zipBytes, { contentType: "application/zip", upsert: true });
  if (upErr) {
    /**
     * The PAGE is never rolled back: it is the expensive part and it is already
     * stored, and reverting the row to stay consistent with a stale zip would
     * throw away the only thing this request paid for.
     *
     * But the two things step 1 wrote ON THE STRENGTH of an upload that then
     * failed are. When this run already had a zip at `output_path`, nothing
     * needs undoing — that object is real, merely one regeneration out of date.
     * When it did NOT (`run.output_path` was null — a run that has never
     * packaged, which is the normal state of the `failed` run this route exists
     * to rescue), the row is now claiming a zip that does not exist, and the
     * promotion to "review" hands that claim to Approve → Deploy. Deploy
     * creates the subdomain BEFORE it downloads the zip, so the operator would
     * be left with a stray empty subdomain and a failed deployment row for a
     * site that was never packaged. So both are put back.
     *
     * Guarded on the `updated_at` step 1 left, for the same reason step 1 is
     * guarded: if anything has moved the row since, this compensation is stale
     * and simply does not land.
     */
    const hadPriorZip = (run.output_path as string | null) != null;
    if (!hadPriorZip) {
      await admin
        .from("builder_runs")
        .update({
          output_path: null,
          ...(promoted ? { status: run.status, error: run.error } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("updated_at", updated.updated_at as string);
    }
    return NextResponse.json(
      {
        error:
          `The page was regenerated and saved, but re-packaging the site zip failed (${upErr.message}). ` +
          (hadPriorZip
            ? `The download is one revision out of date — regenerate this page again to re-package it.`
            : `This run still has no downloadable site — regenerate this page again to package it.`),
      },
      { status: 500 },
    );
  }

  if (!outcome.ok) return NextResponse.json({ run: updated, error: outcome.error }, { status: 502 });
  return NextResponse.json({ run: updated });
}
