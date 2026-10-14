import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { runScheduler } from "@/lib/assistant/scheduler";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * SED AI's scheduler tick (reminders, handover returns, standing rules,
 * expiring proposals). Called every minute by the instrumentation poller with
 * the shared processor secret — never by a browser.
 */

let running = false;

function secretOk(given: string | null): boolean {
  const expected = process.env.WGE_PROCESSOR_SECRET ?? "";
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!secretOk(req.headers.get("x-wge-secret"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // One tick at a time per server; the row claims make overlapping servers safe too.
  if (running) return NextResponse.json({ skipped: "busy" });
  running = true;
  try {
    const report = await runScheduler(createAdminClient());
    if (report.errors.length) console.warn("[assistant-scheduler]", report.errors.slice(0, 5).join(" | "));
    return NextResponse.json(report);
  } finally {
    running = false;
  }
}
