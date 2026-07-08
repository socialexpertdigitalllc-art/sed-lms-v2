import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { trackBatchSchema } from "@/lib/activity/track";

export const runtime = "nodejs";

let lastPrune = 0; // module-level throttle: prune at most ~once/hour

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse(null, { status: 401 });

  const parsed = trackBatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new NextResponse(null, { status: 400 });

  const admin = createAdminClient();
  const rows = parsed.data.events.map((e) => ({
    user_id: user.id,
    type: e.type,
    path: e.path ?? null,
    label: e.label ?? null,
    meta: e.meta ?? null,
  }));
  await admin.from("user_activity").insert(rows);

  try {
    await admin
      .from("user_sessions")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("signed_out_at", null);
  } catch {
    // best-effort heartbeat; never break activity tracking
  }

  const now = Date.now();
  if (now - lastPrune > 3_600_000) {
    lastPrune = now;
    admin.rpc("prune_user_activity").then(() => {}, () => {});
  }
  return new NextResponse(null, { status: 204 });
}
