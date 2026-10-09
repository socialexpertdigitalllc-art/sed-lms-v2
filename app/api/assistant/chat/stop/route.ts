import { NextResponse } from "next/server";
import { assistantGuard, UUID_RE } from "@/lib/assistant/http";
import { stopRun } from "@/lib/assistant/runs";

export const runtime = "nodejs";

/** Stop the answer being written in one of the caller's conversations. What
 *  was written so far is kept and marked as stopped. */
export async function POST(req: Request) {
  const guard = await assistantGuard();
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { conversationId?: unknown } | null;
  const id = typeof body?.conversationId === "string" ? body.conversationId : "";
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "conversationId is required" }, { status: 422 });
  return NextResponse.json({ stopped: stopRun(guard.caller.user.id, id) });
}
