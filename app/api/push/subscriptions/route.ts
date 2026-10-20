import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAllowedPushEndpoint, isPushKey } from "@/lib/push/endpoint";

export const runtime = "nodejs";

async function currentUser(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** GET — how many devices this person has push on, and whether `endpoint`
 *  (this browser) is one of them. */
export async function GET(req: Request) {
  const userId = await currentUser();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const endpoint = new URL(req.url).searchParams.get("endpoint");
  const { data, error } = await createAdminClient().from("push_subscriptions").select("endpoint").eq("user_id", userId);
  if (error) return NextResponse.json({ devices: 0, thisDevice: false, available: false });
  const rows = (data ?? []) as { endpoint: string }[];
  return NextResponse.json({ devices: rows.length, thisDevice: !!endpoint && rows.some((r) => r.endpoint === endpoint), available: true });
}

/** POST — register this browser (a PushSubscription's JSON). A browser that
 *  was registered by someone else moves to the person signed in now. */
export async function POST(req: Request) {
  const userId = await currentUser();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!isAllowedPushEndpoint(body?.endpoint)) {
    return NextResponse.json({ error: "That is not a browser push service address." }, { status: 422 });
  }
  if (!isPushKey(body?.keys?.p256dh, 40, 200) || !isPushKey(body?.keys?.auth, 8, 64)) {
    return NextResponse.json({ error: "The subscription keys are missing or malformed." }, { status: 422 });
  }
  const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 300) || null;
  const { error } = await createAdminClient()
    .from("push_subscriptions")
    .upsert(
      {
        user_id: userId, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth,
        user_agent: userAgent, failure_count: 0, last_failure_at: null,
      },
      { onConflict: "endpoint" },
    );
  if (error) {
    const missing = /push_subscriptions/i.test(error.message) && /does not exist|schema cache/i.test(error.message);
    return NextResponse.json(
      { error: missing ? "The database needs update 0088 (push notifications) first." : error.message },
      { status: missing ? 409 : 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

/** DELETE {endpoint} — stop pushing to this browser (only your own). */
export async function DELETE(req: Request) {
  const userId = await currentUser();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== "string" || !body.endpoint) {
    return NextResponse.json({ error: "endpoint is required" }, { status: 422 });
  }
  await createAdminClient().from("push_subscriptions").delete().eq("endpoint", body.endpoint).eq("user_id", userId);
  return NextResponse.json({ ok: true });
}
