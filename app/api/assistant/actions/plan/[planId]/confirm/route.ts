import { NextResponse } from "next/server";
import { z } from "zod";
import { actionError, actionGuard, requestOrigin } from "@/lib/assistant/actions/http";
import { confirmPlan } from "@/lib/assistant/actions/run";
import { UUID_RE } from "@/lib/assistant/http";

export const runtime = "nodejs";
export const maxDuration = 1800;

/**
 * "Run all": confirm a plan's steps in order, stopping at the first that
 * fails — each step as its card was left (values changed, records unticked).
 */
const draftSchema = z.object({
  edits: z.record(z.string(), z.unknown()).optional(),
  selected: z.array(z.string().uuid()).max(500).optional(),
});
const bodySchema = z.object({
  steps: z
    .record(z.string().uuid(), draftSchema)
    .refine((v) => Object.keys(v).length <= 50, "Too many steps.")
    .optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ planId: string }> }) {
  const guard = await actionGuard();
  if (!guard.ok) return guard.response;
  const { planId } = await params;
  if (!UUID_RE.test(planId)) return NextResponse.json({ error: "That plan was not found." }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 422 });
  try {
    return NextResponse.json({ cards: await confirmPlan(planId, guard.value.ctx, requestOrigin(req), parsed.data.steps ?? {}) });
  } catch (e) {
    return actionError(e);
  }
}
