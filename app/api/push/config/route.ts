import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureVapid } from "@/lib/push/vapid";
import { requestOrigin } from "@/lib/push/endpoint";

export const runtime = "nodejs";

/** GET — the server's public push key, so a browser can subscribe. Generates
 *  the key pair on first use (lib/push/vapid.ts). Any signed-in user. */
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const vapid = await ensureVapid(requestOrigin(req), createAdminClient());
  if (!vapid.ok) return NextResponse.json({ ready: false, reason: vapid.reason });
  return NextResponse.json({ ready: true, publicKey: vapid.keys.publicKey });
}
