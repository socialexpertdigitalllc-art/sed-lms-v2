import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { assistantGuard, storeError } from "@/lib/assistant/http";
import { createConversation, getConversation } from "@/lib/assistant/store";
import { endRun, startRun } from "@/lib/assistant/runs";
import { runTurn } from "@/lib/assistant/engine";
import { titleFromMessage } from "@/lib/assistant/prompt";
import type { AssistantStreamEvent } from "@/lib/assistant/types";

export const runtime = "nodejs";
// A deep question can take several tool rounds; the stream's own idle and
// backstop timers bound each model call well inside this.
export const maxDuration = 600;

/**
 * Ask the assistant something. Streams NDJSON events (see AssistantStreamEvent)
 * while the answer is worked out, and saves everything as it goes — a client
 * that disconnects mid-answer finds the finished reply when it reopens the
 * chat. Starting without a conversationId creates a new conversation, named
 * after the question.
 */

const bodySchema = z.object({
  conversationId: z.string().uuid().nullish(),
  message: z.string().trim().min(1, "Type a message first.").max(8000, "Keep a message under 8,000 characters."),
});

/** Keep-alive: proxies drop a connection that is silent for too long while
 *  the model thinks or a big lookup runs. */
const PING_MS = 15_000;

export async function POST(req: Request) {
  const guard = await assistantGuard();
  if (!guard.ok) return guard.response;
  const { caller } = guard;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 422 });
  }

  const admin = createAdminClient();
  let conversation;
  try {
    conversation = parsed.data.conversationId
      ? await getConversation(admin, caller.user.id, parsed.data.conversationId)
      : await createConversation(admin, caller.user.id, titleFromMessage(parsed.data.message));
  } catch (e) {
    return storeError(e, "Could not open the conversation.");
  }
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const claim = startRun(caller.user.id, conversation.id);
  if ("reason" in claim) {
    return NextResponse.json({ error: claim.message }, { status: claim.reason === "rate" ? 429 : 409 });
  }

  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: AssistantStreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      const ping = setInterval(() => emit({ type: "ping" }), PING_MS);
      void runTurn({
        userId: caller.user.id,
        displayName: caller.displayName,
        perms: caller.perms,
        db: caller.supabase,
        admin,
        conversation: conversation!,
        text: parsed.data.message,
        emit,
        signal: claim.controller.signal,
      })
        .catch((e) => {
          console.error("[assistant] turn crashed:", e);
          emit({ type: "error", message: "Something went wrong while answering. Try again." });
        })
        .finally(() => {
          clearInterval(ping);
          endRun(conversation!.id, claim.controller);
          if (open) {
            open = false;
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          }
        });
    },
    cancel() {
      // The browser went away (tab closed, navigated off). The answer keeps
      // being worked out and saved; only the live mirror stops.
      open = false;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
