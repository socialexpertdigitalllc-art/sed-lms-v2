import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTestPush } from "@/lib/push/dispatch";

export const runtime = "nodejs";

/** POST — send a test notification to every device the caller has on. */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const out = await sendTestPush(createAdminClient(), user.id);
  if (!out.ready) return NextResponse.json({ error: "Push isn't set up on the server yet." }, { status: 409 });
  return NextResponse.json(out);
}
