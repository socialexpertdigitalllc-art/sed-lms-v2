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

  // Same fallback runSite applies on assembly: an HTML components file that
  // is not currently "ok" ships as the template's original (it is a page
  // file, so it isn't in `assets`, and every generated page fetches it).
  const original = findComponentsFile(bundle);
  const baseAssets = { ...bundle.assets };
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
