import { NextResponse } from "next/server";
import { assistantGuard } from "@/lib/assistant/http";
import { proactiveSuggestions } from "@/lib/assistant/proactive";

export const runtime = "nodejs";

/** Things SED AI could take off this person's hands right now (Act mode only). */
export async function GET() {
  const guard = await assistantGuard();
  if (!guard.ok) return guard.response;
  const { caller } = guard;
  if (!caller.perms.has("assistant.act")) return NextResponse.json({ suggestions: [] });
  try {
    return NextResponse.json({ suggestions: await proactiveSuggestions(caller.supabase, caller.user.id, caller.perms) });
  } catch (e) {
    console.error("[assistant] proactive:", e);
    return NextResponse.json({ suggestions: [] });
  }
}
