import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { normalizeFolderId } from "@/lib/google/drive";
import { getGoogleConnection } from "@/lib/google/connection";
import { getLibraryFolderId } from "@/lib/hero-videos/library";
import { HERO_MEDIA_SUBDOMAIN, mediaHostConfigured } from "@/lib/hero-videos/mediaHost";

export const runtime = "nodejs";

/** The library's Drive folder, and whether the pieces it needs are connected. */
export async function GET() {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const admin = createAdminClient();
  const [folderId, conn] = await Promise.all([getLibraryFolderId(admin), getGoogleConnection().catch(() => null)]);
  return NextResponse.json({
    folder_id: folderId,
    folder_url: folderId ? `https://drive.google.com/drive/folders/${folderId}` : null,
    google_account: conn?.account_email ?? null,
    media_host: mediaHostConfigured() ? `https://${HERO_MEDIA_SUBDOMAIN}.${process.env.DA_DOMAIN ?? ""}` : null,
  });
}

const schema = z.object({ folder: z.string().trim().max(500) });

export async function PUT(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paste the Drive folder link." }, { status: 422 });

  // Accept the address-bar link as well as a bare id.
  const folderId = normalizeFolderId(parsed.data.folder) || null;
  const admin = createAdminClient();
  const { error } = await admin
    .from("app_settings")
    .upsert({ singleton: true, hero_videos_folder_id: folderId, updated_at: new Date().toISOString(), updated_by: auth.userId }, { onConflict: "singleton" });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "site_builder.hero_videos.folder_set",
    entity_type: "app_settings",
    entity_id: null,
    new_value: { folder_id: folderId },
  });
  return NextResponse.json({ folder_id: folderId });
}
