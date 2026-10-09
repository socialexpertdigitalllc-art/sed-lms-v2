import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assistantGuard, storeError, UUID_RE } from "@/lib/assistant/http";
import { deleteMemory, MemoryError, updateMemory } from "@/lib/assistant/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const guard = await assistantGuard();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Memory not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { content?: unknown; kind?: unknown } | null;
  if (!body || (body.content === undefined && body.kind === undefined)) {
    return NextResponse.json({ error: "Send content or kind." }, { status: 422 });
  }
  try {
    const memory = await updateMemory(createAdminClient(), guard.caller.user.id, id, body);
    if (!memory) return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    return NextResponse.json({ memory });
  } catch (e) {
    if (e instanceof MemoryError) return NextResponse.json({ error: e.message }, { status: 422 });
    return storeError(e, "Could not update the memory.");
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const guard = await assistantGuard();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Memory not found" }, { status: 404 });
  try {
    const memory = await deleteMemory(createAdminClient(), guard.caller.user.id, id);
    if (!memory) return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (e) {
    return storeError(e, "Could not delete the memory.");
  }
}
