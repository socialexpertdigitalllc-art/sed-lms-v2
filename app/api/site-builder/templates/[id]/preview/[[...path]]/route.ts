import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { contentTypeFor } from "@/lib/site-studio/service/contentType";
import { isSafeAssetPath } from "@/lib/site-studio/preview/assetPath";
import { loadTemplateBundle } from "@/lib/site-builder/templates";
import { rewriteAssetRefs, injectBase } from "@/lib/site-builder/preview";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string; path?: string[] }> };

/**
 * The UNBUILT template, browsable exactly as the run preview serves a built
 * site — same headers, same asset rewriting, same `<base>` injection.
 *
 * Scripts must run (templates render their header/nav/footer from a
 * components.js at runtime, so a script-dead preview shows every page
 * headless), and safety comes from CSP `sandbox allow-scripts` WITHOUT
 * `allow-same-origin`: an opaque origin, no cookies, no storage, no
 * same-origin reach back into the LMS. See the run preview route, which
 * documents this trade-off at length; the reasoning is identical and the
 * headers are deliberately kept identical with it.
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
 * GET — one file of a template's own source:
 *
 *   /preview             -> index.html, or the first page in the zip
 *   /preview/about.html  -> that template page
 *   /preview/css/x.css   -> a template asset
 *
 * This is what "Preview in new tab" opens, for the operator on the templates
 * board and for the salesperson choosing one with a client on the phone.
 * Relative links inside the pages resolve back onto this route naturally, so
 * the whole template is navigable rather than one flat page.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id, path } = await ctx.params;

  const requested = (path ?? []).map((s) => decodeURIComponent(s)).join("/");
  if (requested && !isSafeAssetPath(requested)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const admin = createAdminClient();
  let bundle;
  try {
    bundle = await loadTemplateBundle(admin, id);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not load template" },
      { status: 404 },
    );
  }

  const entry = bundle.pageFiles.includes("index.html") ? "index.html" : bundle.pageFiles[0];
  const target = requested || entry;
  if (!target) return NextResponse.json({ error: "This template has no pages." }, { status: 409 });

  const html = bundle.pages[target];
  if (html !== undefined) {
    const previewBase = `/api/site-builder/templates/${id}/preview/`;
    const known = [...bundle.assetFiles, ...bundle.pageFiles];
    const withBase = injectBase(rewriteAssetRefs(html, known, previewBase), previewBase);
    return new NextResponse(withBase, { headers: previewHeaders(contentTypeFor(target)) });
  }

  const asset = bundle.assets[target];
  if (asset) {
    return new NextResponse(asset as unknown as BodyInit, {
      headers: previewHeaders(contentTypeFor(target)),
    });
  }

  return NextResponse.json({ error: `"${target}" is not in this template.` }, { status: 404 });
}
