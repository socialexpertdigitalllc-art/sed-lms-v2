import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guardAny, guardError } from "@/lib/site-studio/service/guard";
import { contentTypeFor } from "@/lib/site-studio/service/contentType";
import { isSafeAssetPath } from "@/lib/site-studio/preview/assetPath";
import { loadTemplateBundle, TEMPLATE_CATALOGUE_PERMS } from "@/lib/site-builder/templates";
import { encodePathSegments, rewriteAssetRefs, injectBase } from "@/lib/site-builder/preview";
import { planPreviewPage, previewRedirect, splitPreviewToken, verifyPreviewToken } from "@/lib/preview/signedPreview";

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
 * the whole template is navigable rather than one flat page. A page opened
 * with the session is redirected to its SIGNED address (/preview/~<token>/…)
 * so the sandboxed page's own CSS/JS requests, which carry no cookie, still
 * authenticate — see lib/preview/signedPreview.ts.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { id, path } = await ctx.params;
  const scope = `site-builder-template:${id}`;
  const split = splitPreviewToken((path ?? []).map((s) => decodeURIComponent(s)));
  const token = split.token !== null && verifyPreviewToken(scope, split.token) ? split.token : null;
  if (!token) {
    // A read the lead form's picker needs — open to sales, see TEMPLATE_CATALOGUE_PERMS.
    const auth = await guardAny(TEMPLATE_CATALOGUE_PERMS);
    if ("error" in auth) return guardError(auth.error);
  }

  const requested = split.rest.join("/");
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
    const plan = planPreviewPage({
      root: `/api/site-builder/templates/${id}/preview/`,
      scope,
      token,
      requested,
      encodedTarget: encodePathSegments(target),
      search: new URL(req.url).search,
    });
    if ("redirect" in plan) return previewRedirect(plan.redirect);
    const known = [...bundle.assetFiles, ...bundle.pageFiles];
    const withBase = injectBase(rewriteAssetRefs(html, known, plan.assetRoot), plan.base);
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
