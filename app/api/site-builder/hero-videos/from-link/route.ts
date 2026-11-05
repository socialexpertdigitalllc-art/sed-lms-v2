import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { addVideoFromLink, toCard } from "@/lib/hero-videos/library";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({
  link: z.string().trim().min(1).max(1000),
  category: z.string().trim().min(1).max(120),
  /** When set, the new video becomes this lead's hero video (its request is answered). */
  lead_id: z.string().uuid().optional(),
});

/**
 * The developer's answer to "request new video": a Google Drive link. The
 * video is copied into the library (its category's folder), put on the media
 * host, and — with `lead_id` — assigned to that lead.
 */
export async function POST(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paste the video's Drive link and choose its category." }, { status: 422 });

  const admin = createAdminClient();
  try {
    const video = await addVideoFromLink(admin, parsed.data.link, parsed.data.category);
    if (parsed.data.lead_id) {
      const { error } = await admin
        .from("leads")
        .update({ hero_video_id: video.id, hero_video_request: false })
        .eq("id", parsed.data.lead_id)
        .is("deleted_at", null);
      if (error) throw new Error(`The video was added to the library, but not to the lead: ${error.message}`);
    }
    await admin.from("activity_log").insert({
      user_id: auth.userId,
      action: "site_builder.hero_videos.added_from_link",
      entity_type: parsed.data.lead_id ? "lead" : "hero_video",
      entity_id: parsed.data.lead_id ?? video.id,
      new_value: { hero_video_id: video.id, name: video.name, category: video.category },
    });
    return NextResponse.json({ video: toCard(video) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not add the video" }, { status: 400 });
  }
}
