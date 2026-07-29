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
 * `promoted` below). Re-assembles and re-uploads the output zip afterward so
 * the run's `output_path` always reflects the latest per-page state.
 *
 * OWNERSHIP. A single-page write stands aside for a whole-run generation: the
 * update is guarded on `generation_id IS NULL`, so if one was claimed during
 * the minutes this route spent in its AI call, this result is discarded with a
 * 409 rather than overwriting a `pages` snapshot that is now stale. This route
 * takes no token of its own — it is one short write, not an owner of the run,
 * and giving it one would only raise the question of what a generation should
 * do when a regeneration holds it.
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
   * STEP 1 — the write, and it stands aside for a live generation.
   *
   * `.is("generation_id", null)` is the whole guard. Everything above this
   * point read the run MINUTES ago — a paced, retried page call is why this
   * route's maxDuration is 900 — and in that gap the operator can perfectly
   * legitimately hit "Retry failed pages", which claims the run and stamps a
   * token. Landing `newPages` then would overwrite a snapshot taken before
   * that attempt existed, discarding everything it has generated since and
   * possibly flipping a mid-flight run to "review".
   *
   * This route deliberately takes NO token of its own (see the docblock): it
   * is one short write, not a multi-minute owner, and the asymmetry is the
   * point. A run whose process died between claim and release keeps a stale
   * non-null token and would block regeneration forever — that is precisely
   * what /recover exists to clear, since it nulls the token, so the guard has
   * a defined escape hatch rather than being a trap.
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
    .is("generation_id", null)
    .select("*")
    .maybeSingle();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });
  if (!updated) {
    return NextResponse.json(
      {
        error:
          "A generation took over this run while this page was being rewritten, so the regenerated page was discarded. " +
          "Wait for it to finish, then regenerate this page again.",
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
    // NOT rolled back. The regenerated page is the expensive part and it is
    // already stored; reverting the row to stay consistent with a stale zip
    // would throw away the only thing this request paid for. `output_path` is
    // deterministic, so it is already correct — the object behind it is merely
    // one regeneration out of date until this is re-run.
    return NextResponse.json(
      {
        error:
          `The page was regenerated and saved, but re-packaging the site zip failed (${upErr.message}). ` +
          `The download is one revision out of date — regenerate this page again to re-package it.`,
      },
      { status: 500 },
    );
  }

  if (!outcome.ok) return NextResponse.json({ run: updated, error: outcome.error }, { status: 502 });
  return NextResponse.json({ run: updated });
}
