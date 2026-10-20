import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchDuePush } from "@/lib/push/dispatch";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Pushes every notification that has come due (lib/push/dispatch.ts). Called
 * by the instrumentation poller every 30s, and kicked straight after notify()
 * inserts. Same x-wge-secret contract as every processor; listed in
 * middleware's isPublic (a 307 to /login here would silently stop all push).
 */
export async function POST(req: Request) {
  const expected = process.env.WGE_PROCESSOR_SECRET;
  if (!expected) return NextResponse.json({ error: "WGE_PROCESSOR_SECRET is not configured" }, { status: 503 });
  if (req.headers.get("x-wge-secret") !== expected) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await dispatchDuePush(createAdminClient()));
}
