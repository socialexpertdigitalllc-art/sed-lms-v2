import { NextResponse } from "next/server";
import { actionError, actionGuard, requestOrigin } from "@/lib/assistant/actions/http";
import { confirmPlan } from "@/lib/assistant/actions/run";
import { UUID_RE } from "@/lib/assistant/http";

export const runtime = "nodejs";
export const maxDuration = 1800;

/** "Run all": confirm a plan's steps in order, stopping at the first that fails. */
export async function POST(req: Request, { params }: { params: Promise<{ planId: string }> }) {
  const guard = await actionGuard();
  if (!guard.ok) return guard.response;
  const { planId } = await params;
  if (!UUID_RE.test(planId)) return NextResponse.json({ error: "That plan was not found." }, { status: 404 });
  try {
    return NextResponse.json({ cards: await confirmPlan(planId, guard.value.ctx, requestOrigin(req)) });
  } catch (e) {
    return actionError(e);
  }
}
