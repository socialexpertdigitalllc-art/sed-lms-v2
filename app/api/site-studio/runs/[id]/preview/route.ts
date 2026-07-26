import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError, untrustedContentHeaders } from "@/lib/site-studio/service/guard";
import { loadManifest } from "@/lib/site-studio/run/engine";
import { loadPackage } from "@/lib/site-studio/service/templates";
import { contentTypeFor } from "@/lib/site-studio/service/contentType";
import { renderSite } from "@/lib/site-studio/render/renderer";
import { buildPreview } from "@/lib/site-studio/preview/buildPreview";
import { isSafeAssetPath } from "@/lib/site-studio/preview/assetPath";
import type { ContentDoc } from "@/lib/site-studio/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET, two modes on one route — both serve GENERATED, UNTRUSTED markup (an
 * operator-authored Content Document rendered through a client-uploaded
 * template) into the Gate 2 preview iframe, so BOTH modes carry
 * `untrustedContentHeaders`. Same posture Phase 2a established for
 * `/templates/[id]/preview`: the LMS session is same-origin, so unsandboxed
 * HTML here would let an uploaded <script> run with the viewing operator's
 * cookies.
 *
 *  - `?page=<docIndex>` -> the annotated page HTML via `buildPreview`.
 *  - `?asset=<path>` -> one file from the render output (page CSS/images),
 *    streamed with its real content type. The path is caller-supplied and
 *    used as a FileMap lookup key, so it is checked by `isSafeAssetPath`
 *    BEFORE anything else runs — path traversal is the obvious attack on a
 *    route shaped like this and must be refused explicitly (400), not left
 *    to "the lookup happens to fail closed."
 */
export async function GET(req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const url = new URL(req.url);
  const pageParam = url.searchParams.get("page");
  const assetParam = url.searchParams.get("asset");

  if (pageParam === null && assetParam === null) {
    return NextResponse.json({ error: "A page or asset query parameter is required" }, { status: 400 });
  }
  if (pageParam !== null && assetParam !== null) {
    return NextResponse.json({ error: "Provide either page or asset, not both" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: row, error: fetchErr } = await admin.from("studio_runs").select("*").eq("id", id).single();
  if (fetchErr || !row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!row.content_doc) {
    return NextResponse.json({ error: "This run has no content yet" }, { status: 409 });
  }
  const doc = row.content_doc as ContentDoc;

  let manifest;
  try {
    manifest = await loadManifest(admin, row.template_id);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not load template" }, { status: 500 });
  }
  const tpl = await loadPackage(admin, row.template_id, manifest);

  if (assetParam !== null) {
    if (!isSafeAssetPath(assetParam)) {
      return NextResponse.json({ error: "Invalid asset path" }, { status: 400 });
    }
    const rendered = renderSite(tpl, doc, { annotate: true });
    if (!rendered.ok) {
      return NextResponse.json(
        { error: "This run's content is incomplete and cannot be previewed", missing: rendered.missing },
        { status: 409 },
      );
    }
    const bytes = rendered.files[assetParam];
    if (!bytes) return NextResponse.json({ error: "File not in rendered package" }, { status: 404 });
    return new NextResponse(new Uint8Array(bytes), {
      headers: untrustedContentHeaders(contentTypeFor(assetParam)),
    });
  }

  // page mode
  const pageIndex = Number(pageParam);
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= doc.pages.length) {
    return NextResponse.json({ error: `page out of range (doc has ${doc.pages.length} page(s))` }, { status: 404 });
  }

  const preview = buildPreview(tpl, doc, pageIndex, id);
  if (!preview.ok) {
    return NextResponse.json(
      { error: "This run's content is incomplete and cannot be previewed", missing: preview.missing },
      { status: 409 },
    );
  }

  // `allowSameOrigin: true` — FIX 1 (Phase 4a review): this response is the
  // one `RunPreview`'s iframe navigates to, and that iframe carries
  // `sandbox="allow-same-origin"` specifically so its parent can reach
  // `contentDocument` for click-to-edit. The two must agree (see
  // `untrustedContentHeaders`'s own cross-reference note) or the combined
  // sandbox forces an opaque origin and click-to-edit goes dead. The asset
  // branch above is NOT the navigated document (it's `<img>`/`<link>`
  // subresources the page itself loads), so it is left on the strict
  // default.
  return new NextResponse(preview.html, {
    headers: untrustedContentHeaders("text/html", { allowSameOrigin: true }),
  });
}
