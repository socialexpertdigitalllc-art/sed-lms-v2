import { NextResponse } from "next/server";
import { actionError, actionGuard } from "@/lib/assistant/actions/http";
import { cancelAction } from "@/lib/assistant/actions/run";
import { UUID_RE } from "@/lib/assistant/http";

export const runtime = "nodejs";

/** Cancel a proposal (or withdraw a request waiting for approval). Nothing changes. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await actionGuard();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "That action was not found." }, { status: 404 });
  try {
    return NextResponse.json({ card: await cancelAction(id, guard.value.ctx) });
  } catch (e) {
    return actionError(e);
  }
}
