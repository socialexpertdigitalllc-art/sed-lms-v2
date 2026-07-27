import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError, untrustedContentHeaders } from "@/lib/site-studio/service/guard";
import { contentTypeFor } from "@/lib/site-studio/service/contentType";
import { loadTemplateBundle } from "@/lib/site-builder/templates";
import { rewriteAssetRefs } from "@/lib/site-builder/preview";
import type { PageState } from "@/lib/site-builder/run";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET, two modes on one route — mirrors `app/api/site-studio/runs/[id]/
 * preview/route.ts`'s own `?page=`/`?asset=` split, but there is no compiler
 * or manifest behind it: a page is just the AI's own generated HTML for that
 * file, and an asset is a template file copied through untouched (see
 * `templates.ts`/`run.ts`). Both branches serve UNTRUSTED, model-written or
 * client-uploaded markup, so both carry `untrustedContentHeaders` at its
 * strict default (no `allowSameOrigin` — there is no click-to-edit here, so
 * the consuming iframe never needs `contentDocument` access).
 *
 *  - `?file=<name>` -> the page's generated HTML, with its asset references
 *    rewritten (see `rewriteAssetRefs`) so relative AND root-absolute
 *    template paths both resolve through THIS route's `?asset=` branch — the
 *    rewrite is preview-only and never touches the run's own `pages` state
 *    or its assembled output zip.
 *  - `?asset=<path>` -> one file from the template's own asset list,
 *    streamed with its real content type.
 */
export async function GET(req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const url = new URL(req.url);
  const fileParam = url.searchParams.get("file");
  const assetParam = url.searchParams.get("asset");

  if (fileParam === null && assetParam === null) {
    return NextResponse.json({ error: "A file or asset query parameter is required" }, { status: 400 });
  }
  if (fileParam !== null && assetParam !== null) {
    return NextResponse.json({ error: "Provide either file or asset, not both" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: run, error: fetchErr } = await admin.from("builder_runs").select("template_id, pages").eq("id", id).single();
  if (fetchErr || !run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let bundle;
  try {
    bundle = await loadTemplateBundle(admin, run.template_id as string);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not load template" }, { status: 500 });
  }

  if (assetParam !== null) {
    const bytes = bundle.assets[assetParam];
    if (!bytes) return NextResponse.json({ error: "File not in this template" }, { status: 404 });
    return new NextResponse(new Uint8Array(bytes), { headers: untrustedContentHeaders(contentTypeFor(assetParam)) });
  }

  const pages = (run.pages ?? {}) as Record<string, PageState>;
  const page = pages[fileParam as string];
  if (!page) return NextResponse.json({ error: `Unknown page "${fileParam}" for this run.` }, { status: 404 });
  if (page.status !== "ok" || page.html === undefined) {
    return NextResponse.json({ error: page.error ?? "This page failed to generate." }, { status: 409 });
  }

  const previewAssetBase = `/api/site-builder/runs/${id}/preview?asset=`;
  const html = rewriteAssetRefs(page.html, bundle.assetFiles, previewAssetBase);

  return new NextResponse(html, { headers: untrustedContentHeaders("text/html") });
}
