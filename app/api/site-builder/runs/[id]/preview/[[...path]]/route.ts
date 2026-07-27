import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { contentTypeFor } from "@/lib/site-studio/service/contentType";
import { isSafeAssetPath } from "@/lib/site-studio/preview/assetPath";
import { unzipToMap } from "@/lib/site-studio/zip";
import { loadTemplateBundle } from "@/lib/site-builder/templates";
import { rewriteAssetRefs, injectBase } from "@/lib/site-builder/preview";
import { isSiteImagePath } from "@/lib/site-builder/siteImages";
import { BUILDER_SITES_BUCKET, type PageState } from "@/lib/site-builder/run";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string; path?: string[] }> };

/**
 * Headers for the Site Builder preview. Unlike Site Studio's strict
 * `untrustedContentHeaders` (which strips script execution entirely), this
 * preview MUST run scripts: Site Builder templates render their shared
 * header/nav/footer/booking form from a `components.js` at runtime — a
 * script-dead preview shows every page headless, which is useless for the
 * "check the whole site before deploying" job this route exists for.
 *
 * Safety comes from CSP `sandbox allow-scripts` WITHOUT `allow-same-origin`:
 * scripts execute, but the document gets an opaque origin — no cookies, no
 * storage, no same-origin reach into the LMS. (allow-scripts +
 * allow-same-origin together would be the dangerous combination; this is
 * deliberately only the first.) The consuming iframe mirrors this with
 * `sandbox="allow-scripts"` — the two lists combine restrictively, see
 * guard.ts's cross-reference note. External loads are held to what a real
 * template page needs: its own preview-served files, https imagery/fonts
 * (rehosted picks live on Supabase storage), and https frames (the Google
 * map embed).
 */
function previewHeaders(contentType: string): HeadersInit {
  return {
    "Content-Type": contentType,
    "Content-Security-Policy":
      "sandbox allow-scripts allow-forms allow-popups; default-src 'none'; " +
      "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https:; " +
      "img-src 'self' data: blob: https:; font-src 'self' data: https:; " +
      "frame-src https:; media-src 'self' https:; connect-src 'self'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Cache-Control": "private, max-age=0, must-revalidate",
  };
}

/**
 * GET — one file of a run's generated site, addressed by PATH, so the whole
 * site is browsable exactly as it will deploy:
 *
 *   /preview            -> the entry page (index.html, or the first ok page)
 *   /preview/about.html -> that generated page
 *   /preview/css/x.css  -> a template asset (or the run's rewritten
 *                          components file, which shadows the template's copy)
 *
 * Relative links inside a page ("about.html", "css/style.css") resolve
 * against the preview URL and land back on this route naturally; only
 * root-absolute references need rewriting (see `rewriteAssetRefs`), which is
 * why "open in a new tab" gives a fully navigable site, not one page.
 *
 * The old `?file=`/`?asset=` query mode is still accepted on the bare
 * /preview path for anything that linked it.
 */
export async function GET(req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id, path } = await ctx.params;

  const url = new URL(req.url);
  const legacyFile = url.searchParams.get("file");
  const legacyAsset = url.searchParams.get("asset");
  const segments = (path ?? []).map((s) => decodeURIComponent(s));
  const requested = segments.join("/") || legacyFile || legacyAsset || "";

  if (requested && !isSafeAssetPath(requested)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: run, error: fetchErr } = await admin
    .from("builder_runs")
    .select("template_id, pages, output_path, images")
    .eq("id", id)
    .single();
  if (fetchErr || !run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let bundle;
  try {
    bundle = await loadTemplateBundle(admin, run.template_id as string);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not load template" }, { status: 500 });
  }

  const pages = (run.pages ?? {}) as Record<string, PageState>;
  const okHtmlPages = Object.keys(pages)
    .filter((f) => /\.html?$/i.test(f) && pages[f].kind !== "component" && pages[f].status === "ok")
    .sort();

  // Bare /preview -> the entry page.
  const target = requested || (okHtmlPages.includes("index.html") ? "index.html" : okHtmlPages[0]);
  if (!target) {
    return NextResponse.json({ error: "No page of this run has generated yet." }, { status: 409 });
  }

  const page = pages[target];
  if (page) {
    if (page.status !== "ok" || page.html === undefined) {
      return NextResponse.json({ error: page.error ?? `"${target}" has not generated yet.` }, { status: 409 });
    }
    // `?raw=1` — the exact generated source as plain text, never rendered or
    // rewritten (backs the code viewer's "Raw" link). text/plain so a browser
    // shows the markup instead of executing it.
    if (url.searchParams.get("raw") === "1") {
      return new NextResponse(page.html, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, max-age=0, must-revalidate",
        },
      });
    }
    const contentType = contentTypeFor(target);
    // The components file ships as source (usually JS) — served raw. Pages
    // (and an HTML components include) get their root-absolute references
    // routed back through this preview.
    if (!/\.html?$/i.test(target)) {
      return new NextResponse(page.html, { headers: previewHeaders(contentType) });
    }
    const previewBase = `/api/site-builder/runs/${id}/preview/`;
    // Bundled images join the known-file list so a ROOT-ABSOLUTE reference to
    // one ("/images/hero-1.jpg") is routed through the preview like any other
    // asset. A plain relative reference — what the prompt asks for and what
    // pages normally carry — is already handled by the injected <base>.
    const imagePaths = Array.isArray(run.images)
      ? (run.images as { url?: unknown }[]).map((i) => (typeof i.url === "string" ? i.url : "")).filter(Boolean)
      : [];
    const known = [...bundle.assetFiles, ...Object.keys(pages), ...imagePaths];
    const rewritten = rewriteAssetRefs(page.html, known, previewBase);
    // A `<base>` makes RELATIVE references resolve against the preview
    // directory no matter which URL this page was opened at — critically the
    // nav/footer links that `components.js` inserts at RUNTIME (rewriteAssetRefs
    // can't see those, they aren't in the served HTML). Without it, "Open
    // preview" (opened at `.../preview/`) works but the whole-site navigation
    // breaks the moment a script-inserted link resolves against the wrong base.
    // Injected right after <head> so it precedes any script or asset.
    const withBase = injectBase(rewritten, previewBase);
    return new NextResponse(withBase, {
      headers: previewHeaders("text/html"),
    });
  }

  const bytes = bundle.assets[target];
  if (bytes) return new NextResponse(new Uint8Array(bytes), { headers: previewHeaders(contentTypeFor(target)) });

  // Bundled site images are NOT template assets — they were downloaded into
  // the site at generation time and live only in the run's output zip (see
  // siteImages.ts). Serving them here is what makes the preview show the same
  // images the deployed site will.
  if (isSiteImagePath(target) && run.output_path) {
    const { data: zipBlob } = await admin.storage.from(BUILDER_SITES_BUCKET).download(run.output_path as string);
    if (zipBlob) {
      try {
        const files = unzipToMap(new Uint8Array(await zipBlob.arrayBuffer()));
        const image = files[target];
        if (image) {
          return new NextResponse(new Uint8Array(image), { headers: previewHeaders(contentTypeFor(target)) });
        }
      } catch {
        // fall through to the 404 below
      }
    }
  }

  return NextResponse.json({ error: "File not in this run or its template" }, { status: 404 });
}
