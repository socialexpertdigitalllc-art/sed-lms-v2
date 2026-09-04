import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guardAny, guardError } from "@/lib/site-studio/service/guard";
import { BUILDER_TEMPLATES_BUCKET, TEMPLATE_CATALOGUE_PERMS } from "@/lib/site-builder/templates";
import { contentTypeFor } from "@/lib/site-studio/service/contentType";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET — a template's cover screenshot.
 *
 * Served through the app rather than from a public bucket URL: the bucket
 * holds the template SOURCE too, and making it public to show a picture would
 * publish every template zip we own. The image is immutable for a given
 * template (a replacement writes a new row value), so it caches hard.
 */
export async function GET(_req: Request, ctx: Ctx) {
  // A read the lead form's picker needs — open to sales, see TEMPLATE_CATALOGUE_PERMS.
  const auth = await guardAny(TEMPLATE_CATALOGUE_PERMS);
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("builder_templates")
    .select("cover_image_path")
    .eq("id", id)
    .maybeSingle();
  const path = row?.cover_image_path as string | undefined;
  if (!path) return NextResponse.json({ error: "No cover image" }, { status: 404 });

  const { data, error } = await admin.storage.from(BUILDER_TEMPLATES_BUCKET).download(path);
  if (error || !data) return NextResponse.json({ error: "Cover image is missing" }, { status: 404 });

  return new NextResponse(await data.arrayBuffer(), {
    headers: {
      "Content-Type": contentTypeFor(path),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
