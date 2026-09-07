// app/api/forms/deliver/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deliverSubmission } from "@/lib/forms/deliver";
import { MAX_DELIVERY_ATTEMPTS } from "@/lib/forms/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Retry sweep for form deliveries that are still pending (process died
 * between insert and after()) or failed (SMTP outage). Secret-header auth,
 * same contract as /api/site-builder/process; called by instrumentation.ts
 * every 2 minutes. One indexed query when idle.
 */
export async function POST(req: Request) {
  const expected = process.env.WGE_PROCESSOR_SECRET;
  if (!expected) return NextResponse.json({ error: "WGE_PROCESSOR_SECRET is not configured" }, { status: 503 });
  if (req.headers.get("x-wge-secret") !== expected) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("form_submissions")
    .select("id")
    .in("delivery_status", ["pending", "failed"])
    .lt("delivery_attempts", MAX_DELIVERY_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(8); // sized so a tick of worst-case sends fits maxDuration
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let sent = 0, failed = 0;
  for (const row of data ?? []) {
    const r = await deliverSubmission(row.id as string);
    if (r.status === "sent") sent++;
    else if (r.status === "failed") failed++;
  }
  return NextResponse.json({ processed: (data ?? []).length, sent, failed });
}
