import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assistantGuard, storeError } from "@/lib/assistant/http";
import { addMemory, listMemories, MemoryError } from "@/lib/assistant/store";

export const runtime = "nodejs";

/** The caller's own assistant memories — what it knows about them. */
export async function GET() {
  const guard = await assistantGuard();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ memories: await listMemories(createAdminClient(), guard.caller.user.id) });
  } catch (e) {
    return storeError(e, "Could not load your memories.");
  }
}

/** Teach it something directly from the Memory panel. */
export async function POST(req: Request) {
  const guard = await assistantGuard();
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { content?: unknown; kind?: unknown } | null;
  try {
    const { memory, duplicate } = await addMemory(createAdminClient(), guard.caller.user.id, {
      content: body?.content,
      kind: body?.kind,
      source: "user",
    });
    return NextResponse.json({ memory, duplicate }, { status: duplicate ? 200 : 201 });
  } catch (e) {
    if (e instanceof MemoryError) return NextResponse.json({ error: e.message }, { status: 422 });
    return storeError(e, "Could not save the memory.");
  }
}
