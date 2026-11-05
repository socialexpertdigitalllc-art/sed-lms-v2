import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { importHeroVideo } from "@/lib/hero-videos/library";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({
  drive_file_id: z.string().trim().min(10).max(200),
  category: z.string().trim().min(1).max(120),
});

/** Step 2 of Sync: copy ONE library video from Drive to the media host. */
export async function POST(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "drive_file_id and category are required" }, { status: 422 });

  const admin = createAdminClient();
  try {
    const video = await importHeroVideo(admin, parsed.data.drive_file_id, parsed.data.category);
    return NextResponse.json({ video });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Import failed" }, { status: 400 });
  }
}
