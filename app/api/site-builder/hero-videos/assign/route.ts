import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { getHeroVideo, toCard, usable } from "@/lib/hero-videos/library";

export const runtime = "nodejs";

const schema = z.object({ lead_id: z.string().uuid(), hero_video_id: z.string().uuid() });

/** The developer swaps a lead's hero video for another library video (New Site screen). */
export async function POST(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "lead_id and hero_video_id are required" }, { status: 422 });

  const admin = createAdminClient();
  const video = await getHeroVideo(admin, parsed.data.hero_video_id);
  if (!usable(video)) return NextResponse.json({ error: "That video is not in the library any more." }, { status: 404 });

  const { data: lead, error } = await admin
    .from("leads")
    .update({ hero_video_id: video!.id, hero_video_request: false })
    .eq("id", parsed.data.lead_id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "site_builder.hero_videos.assigned",
    entity_type: "lead",
    entity_id: parsed.data.lead_id,
    new_value: { hero_video_id: video!.id, name: video!.name, category: video!.category },
  });
  return NextResponse.json({ video: toCard(video!) });
}
