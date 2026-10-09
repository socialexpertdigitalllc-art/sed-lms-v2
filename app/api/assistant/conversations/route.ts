import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assistantGuard, storeError, toClientConversation } from "@/lib/assistant/http";
import { listConversations } from "@/lib/assistant/store";

export const runtime = "nodejs";

/** The caller's own conversations, pinned first, then most recent. */
export async function GET() {
  const guard = await assistantGuard();
  if (!guard.ok) return guard.response;
  try {
    const conversations = await listConversations(createAdminClient(), guard.caller.user.id);
    return NextResponse.json({ conversations: conversations.map(toClientConversation) });
  } catch (e) {
    return storeError(e, "Could not load your conversations.");
  }
}
