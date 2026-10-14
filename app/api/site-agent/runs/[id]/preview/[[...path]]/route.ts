// app/api/site-agent/runs/[id]/preview/[[...path]]/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agentRunAccess } from "@/lib/site-agent/access";
import { contentTypeFor } from "@/lib/site-studio/service/contentType";
import { isSafeAssetPath } from "@/lib/site-studio/preview/assetPath";
import { encodePathSegments, rewriteAssetRefs, injectBase } from "@/lib/site-builder/preview";
import { planPreviewPage, previewRedirect, splitPreviewToken, verifyPreviewToken } from "@/lib/preview/signedPreview";
import { loadRunMap } from "@/lib/site-agent/resultCache";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string; path?: string[] }> };

/**
 * Headers for the agent-result preview — same stance as the Site Builder
 * preview (see app/api/site-builder/runs/[id]/preview): the AI-edited site
 * MUST run its scripts (nav/footer/booking widgets are runtime-rendered on
 * these sites), so safety comes from CSP `sandbox allow-scripts` WITHOUT
 * `allow-same-origin` — scripts execute under an opaque origin with no
 * cookies, no storage, no same-origin reach into the LMS. (allow-scripts +
 * allow-same-origin together would be the dangerous combination; this is
 * deliberately only the first.) The review screen's iframe mirrors this with
 * `sandbox="allow-scripts"` — the two lists combine restrictively. External
 * loads are held to what a real site page needs: its own preview-served
 * files, https imagery/fonts, and https frames (map embeds).
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
 * GET — one file of a run's RESULT zip (the AI-edited site), addressed by
 * PATH, so the whole edited site is browsable before deploying:
 *
 *   /preview            -> index.html (the harvest guarantees one)
 *   /preview/about.html -> that page
 *   /preview/css/x.css  -> an asset
 *
 * A page opened with the session (the review iframe, "Open in a new tab") is
 * redirected to its SIGNED address, /preview/~<token>/index.html: the opaque-
 * origin page sends no cookie with its own requests, so its CSS, JS and links
 * authenticate with the token its relative URLs inherit (lib/preview/
 * signedPreview.ts). Root-absolute references get rewritten (see
 * `rewriteAssetRefs`), so "open in a new tab" gives a fully navigable site.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { id, path } = await ctx.params;
  const admin = createAdminClient();
  const scope = `site-agent-run:${id}`;
  const split = splitPreviewToken((path ?? []).map((s) => decodeURIComponent(s)));
  const token = split.token !== null && verifyPreviewToken(scope, split.token) ? split.token : null;

  // A valid token stands in for the session (the sandboxed page has none to
  // send); anything else goes through the full access gate.
  let version: string;
  if (token) {
    const { data: row } = await admin.from("site_agent_runs").select("updated_at").eq("id", id).maybeSingle();
    if (!row) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    version = String((row as { updated_at: string }).updated_at);
  } else {
    const access = await agentRunAccess(admin, id);
    if ("error" in access) return access.error;
    version = access.run.updated_at;
  }

  const url = new URL(req.url);
  const requested = split.rest.join("/");
  if (requested && !isSafeAssetPath(requested)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  // Result zip only exists once the worker harvested — before that the review
  // screen has nothing to show (updated_at in the key means a transition is
  // picked up immediately despite the 60s TTL).
  const map = await loadRunMap(admin, id, "result", version);
  if (!map) {
    return NextResponse.json({ error: "This run has no edited files yet." }, { status: 409 });
  }

  // Bare /preview -> the entry page. Harvest guarantees an index.html; the
  // first HTML file is a belt-and-braces fallback for a hand-touched bucket.
  const htmlFiles = Object.keys(map).filter((f) => /\.html?$/i.test(f)).sort();
  const target = requested || (map["index.html"] ? "index.html" : htmlFiles[0]);
  const bytes = target ? map[target] : undefined;
  if (!target || !bytes) {
    return NextResponse.json({ error: "File not in this run's result" }, { status: 404 });
  }

  // `?raw=1` — the exact edited source as plain text, never rendered or
  // rewritten (backs the code viewer's "Raw" link). text/plain so a browser
  // shows the markup instead of executing it.
  if (url.searchParams.get("raw") === "1") {
    return new NextResponse(new TextDecoder().decode(bytes), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  }

  const contentType = contentTypeFor(target);
  if (!/\.html?$/i.test(target)) {
    return new NextResponse(new Uint8Array(bytes), { headers: previewHeaders(contentType) });
  }

  const plan = planPreviewPage({
    root: `/api/site-agent/runs/${id}/preview/`,
    scope,
    token,
    requested,
    encodedTarget: encodePathSegments(target),
    search: url.search,
  });
  if ("redirect" in plan) return previewRedirect(plan.redirect);
  const rewritten = rewriteAssetRefs(new TextDecoder().decode(bytes), Object.keys(map), plan.assetRoot);
  // A `<base>` makes RELATIVE references (including ones a script inserts at
  // runtime, which rewriteAssetRefs can't see) resolve against this page's
  // signed address no matter which URL it was opened at. Injected right
  // after <head> so it precedes any script or asset.
  const withBase = injectBase(rewritten, plan.base);
  return new NextResponse(withBase, { headers: previewHeaders(contentType) });
}
