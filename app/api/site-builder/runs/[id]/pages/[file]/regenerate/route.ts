import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { unzipToMap } from "@/lib/site-studio/zip";
import { siteImagesFromZip, localizeImages } from "@/lib/site-builder/siteImages";
import { loadTemplateBundle } from "@/lib/site-builder/templates";
import { productionSiteBuildCall } from "@/lib/site-builder/generate";
import { regeneratePage, buildBrief, assembleZip, findComponentsFile, outputPathFor, BUILDER_SITES_BUCKET, type PageState } from "@/lib/site-builder/run";
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
  const storedImages = Array.isArray(run.images) ? (run.images as SuppliedImage[]) : [];

  // A run generated BEFORE images were bundled still holds raw signed storage
  // URLs (no `file`). Feeding one back to the model would reproduce the exact
  // bug this replaced — a mangled ?token= and a broken <img> — so such a run
  // heals here: its picks are downloaded into the site now, and the freshly
  // localized paths are what the prompt and the rebuilt zip both use.
  let images = storedImages;
  let healedFiles: Record<string, Uint8Array> = {};
  let healedImages: SuppliedImage[] | null = null;
  if (storedImages.length > 0 && storedImages.every((i) => !i.file)) {
    const localized = await localizeImages(storedImages);
    images = localized.images;
    healedFiles = localized.files;
    healedImages = localized.images;
  }
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

  // The site's bundled images live in the CURRENT output zip and nowhere else
  // (see siteImages.ts) — carry them across, or a regeneration would rebuild
  // the site without the very images the pages reference.
  let carriedImages: Record<string, Uint8Array> = {};
  if (run.output_path) {
    const { data: priorZip } = await admin.storage.from(BUILDER_SITES_BUCKET).download(run.output_path as string);
    if (priorZip) {
      try {
        carriedImages = siteImagesFromZip(unzipToMap(new Uint8Array(await priorZip.arrayBuffer())));
      } catch {
        // A corrupt prior zip must not block a regeneration; the page still
        // rewrites, and the operator can regenerate the run to restore images.
      }
    }
  }

  // Same fallback runSite applies on assembly: an HTML components file that
  // is not currently "ok" ships as the template's original (it is a page
  // file, so it isn't in `assets`, and every generated page fetches it).
  const original = findComponentsFile(bundle);
  const baseAssets = { ...bundle.assets, ...carriedImages, ...healedFiles };
  if (original && bundle.pages[original.file] !== undefined && newPages[original.file]?.status !== "ok") {
    baseAssets[original.file] = new TextEncoder().encode(original.source);
  }

  const zipBytes = assembleZip(baseAssets, newPages);
  const outputPath = outputPathFor(id);
  const { error: upErr } = await admin.storage
    .from(BUILDER_SITES_BUCKET)
    .upload(outputPath, zipBytes, { contentType: "application/zip", upsert: true });
  if (upErr) return NextResponse.json({ error: `zip upload failed: ${upErr.message}` }, { status: 500 });

  const { data: updated, error: updErr } = await admin
    .from("builder_runs")
    .update({
      pages: newPages,
      output_path: outputPath,
      // Only written when an old run was healed above; otherwise the stored
      // picks are already the in-site paths and must not be disturbed.
      ...(healedImages ? { images: healedImages } : {}),
      updated_at: new Date().toISOString(),
    })
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
