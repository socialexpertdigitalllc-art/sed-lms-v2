import { NextResponse } from "next/server";
import { z } from "zod";
import { actionError, actionGuard, requestOrigin } from "@/lib/assistant/actions/http";
import { confirmAction, rejectAction } from "@/lib/assistant/actions/run";
import { UUID_RE } from "@/lib/assistant/http";

export const runtime = "nodejs";
export const maxDuration = 900;

/**
 * An approver decides on a request. Approving RUNS it — as the approver, with
 * the approver's own permissions (the requester could not); rejecting tells
 * the requester why.
 */
const bodySchema = z.object({ approve: z.boolean(), note: z.string().trim().max(500).optional() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await actionGuard({ manage: true });
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "That action was not found." }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Say approve or reject." }, { status: 422 });
  const { ctx } = guard.value;
  try {
    const card = parsed.data.approve
      ? await confirmAction({ id, ctx, origin: requestOrigin(req), asApprover: { note: parsed.data.note ?? null } })
      : await rejectAction(id, ctx, parsed.data.note ?? null);
    return NextResponse.json({ card });
  } catch (e) {
    return actionError(e);
  }
}
