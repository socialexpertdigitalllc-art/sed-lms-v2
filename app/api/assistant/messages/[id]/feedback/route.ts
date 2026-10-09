import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { assistantGuard, storeError, UUID_RE } from "@/lib/assistant/http";
import { setAnswerFeedback } from "@/lib/assistant/store";

export const runtime = "nodejs";

/**
 * Rate one of the caller's answers — thumbs up, thumbs down, or neither
 * (null clears it). Kept on the answer itself, private like the rest of the
 * chat. Someone else's message id reads as not found.
 */

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({ feedback: z.enum(["up", "down"]).nullable() });

export async function POST(req: Request, { params }: Ctx) {
  const guard = await assistantGuard();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Answer not found" }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send feedback: \"up\", \"down\" or null." }, { status: 422 });
  try {
    const found = await setAnswerFeedback(createAdminClient(), guard.caller.user.id, id, parsed.data.feedback);
    if (!found) return NextResponse.json({ error: "Answer not found" }, { status: 404 });
    return NextResponse.json({ ok: true, feedback: parsed.data.feedback });
  } catch (e) {
    return storeError(e, "Could not save your feedback.");
  }
}
