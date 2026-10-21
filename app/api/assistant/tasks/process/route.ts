import { NextResponse, after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { runDueTasks } from "@/lib/assistant/taskRunner";

export const runtime = "nodejs";
export const maxDuration = 1800;

/**
 * SED AI's background tasks (lib/assistant/taskRunner.ts): called every 30s
 * by the instrumentation poller with the shared processor secret — never by a
 * browser. Answers at once and runs the due tasks after the response: a run
 * can take many minutes, and the poller must not sit on a request that long.
 * One sweep at a time per server (the runner's own flag); the task claims and
 * heartbeats make a run that died with the server start again.
 */

function secretOk(given: string | null): boolean {
  const expected = process.env.WGE_PROCESSOR_SECRET ?? "";
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!secretOk(req.headers.get("x-wge-secret"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  after(() =>
    runDueTasks(createAdminClient()).then(
      () => undefined,
      (e) => console.error("[assistant/tasks] sweep failed:", e),
    ),
  );
  return NextResponse.json({ accepted: true });
}
