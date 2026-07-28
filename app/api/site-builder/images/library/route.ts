import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { searchBuilderImages } from "@/lib/site-builder/imageLibrary";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET — Site Builder's own image library: links previously used for a
 * service, ready to reuse without another Pexels call.
 *
 * Deliberately NOT `/api/site-studio/assets`, which lists Site Studio's
 * rehosted BYTES and can only be viewed through short-lived signed URLs from
 * a private bucket. Site Builder links to images at their own public URL, so
 * it reads its own link library instead (see migration 0060).
 */
export async function GET(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const { searchParams } = new URL(req.url);
  const subject = searchParams.get("subject")?.trim() || undefined;
  const leadId = searchParams.get("lead_id")?.trim() || undefined;

  const admin = createAdminClient();
  const rows = await searchBuilderImages(admin, { subject, leadId });

  return NextResponse.json({
    images: rows.map((r) => ({
      id: r.id,
      url: r.url,
      thumb_url: r.thumb_url ?? r.url,
      subject: r.subject,
      source: r.source,
      photographer: r.photographer,
      width: r.width,
      height: r.height,
      use_count: r.use_count,
    })),
  });
}
