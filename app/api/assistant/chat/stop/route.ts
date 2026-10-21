import { NextResponse } from "next/server";
import { assistantGuard, UUID_RE } from "@/lib/assistant/http";
import { stopRun } from "@/lib/assistant/runs";
import { createAdminClient } from "@/lib/supabase/admin";
import { runningTask, stopTask } from "@/lib/assistant/tasks";

export const runtime = "nodejs";

/** Stop the answer being written in one of the caller's conversations. What
 *  was written so far is kept and marked as stopped. Stop means stop: a
 *  background task running in that chat stops too (it won't start again). */
export async function POST(req: Request) {
  const guard = await assistantGuard();
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { conversationId?: unknown } | null;
  const id = typeof body?.conversationId === "string" ? body.conversationId : "";
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "conversationId is required" }, { status: 422 });
  const userId = guard.caller.user.id;
  const admin = createAdminClient();
  const task = await runningTask(admin, id);
  const taskStopped = task && task.user_id === userId ? Boolean(await stopTask(admin, userId, task.id).catch(() => null)) : false;
  return NextResponse.json({ stopped: stopRun(userId, id), taskStopped });
}
