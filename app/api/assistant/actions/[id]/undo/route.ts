import { NextResponse } from "next/server";
import { actionError, actionGuard } from "@/lib/assistant/actions/http";
import { undoAction } from "@/lib/assistant/actions/run";
import { UUID_RE } from "@/lib/assistant/http";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Undo a change SED AI made, while its undo window is open. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await actionGuard();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "That action was not found." }, { status: 404 });
  try {
    return NextResponse.json({ card: await undoAction(id, guard.value.ctx) });
  } catch (e) {
    return actionError(e, "It could not be undone.");
  }
}
