import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assistantGuard, UUID_RE } from "@/lib/assistant/http";
import { stopRun } from "@/lib/assistant/runs";
import { getTask, stopTask, taskView } from "@/lib/assistant/tasks";

export const runtime = "nodejs";

/** Stop one of the caller's background tasks — and its run, if one is going right now. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await assistantGuard();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  const admin = createAdminClient();
  const userId = guard.caller.user.id;
  const task = await getTask(admin, id).catch(() => null);
  if (!task || task.user_id !== userId) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  const stopped = await stopTask(admin, userId, id).catch(() => null);
  // A run going right now stops too (what it already changed stays, and can be undone).
  stopRun(userId, task.conversation_id);
  const now = stopped ?? (await getTask(admin, id).catch(() => null)) ?? task;
  return NextResponse.json({ task: taskView(now) });
}
