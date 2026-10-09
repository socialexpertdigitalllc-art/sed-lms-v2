import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { assistantGuard, storeError, toClientConversation, toUiMessage, UUID_RE } from "@/lib/assistant/http";
import { deleteConversation, getConversation, listMessages, updateConversation } from "@/lib/assistant/store";
import { isRunning, stopRun } from "@/lib/assistant/runs";

export const runtime = "nodejs";

/**
 * One of the caller's conversations. Every lookup is pinned to the caller's
 * own user id (see lib/assistant/store.ts): someone else's conversation id
 * reads as "not found", never as forbidden.
 */

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const guard = await assistantGuard();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  const admin = createAdminClient();
  try {
    const conversation = await getConversation(admin, guard.caller.user.id, id);
    if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    const messages = await listMessages(admin, guard.caller.user.id, id);
    return NextResponse.json({ conversation: toClientConversation(conversation), messages: messages.map(toUiMessage), running: isRunning(id) });
  } catch (e) {
    return storeError(e, "Could not load the conversation.");
  }
}

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  pinned: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const guard = await assistantGuard();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || (parsed.data.title === undefined && parsed.data.pinned === undefined)) {
    return NextResponse.json({ error: "Send a title or pinned." }, { status: 422 });
  }
  try {
    const conversation = await updateConversation(createAdminClient(), guard.caller.user.id, id, parsed.data);
    if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    return NextResponse.json({ conversation: toClientConversation(conversation) });
  } catch (e) {
    return storeError(e, "Could not update the conversation.");
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const guard = await assistantGuard();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  // An answer still being written would otherwise keep saving into a
  // conversation that no longer exists.
  stopRun(guard.caller.user.id, id);
  try {
    const removed = await deleteConversation(createAdminClient(), guard.caller.user.id, id);
    if (!removed) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (e) {
    return storeError(e, "Could not delete the conversation.");
  }
}
