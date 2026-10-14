import { NextResponse } from "next/server";
import { z } from "zod";
import { actionError, actionGuard, requestOrigin } from "@/lib/assistant/actions/http";
import { confirmAction } from "@/lib/assistant/actions/run";
import { UUID_RE } from "@/lib/assistant/http";

export const runtime = "nodejs";
// Some changes take a while: regenerating a page (up to 15 min), deploying,
// buying a domain.
export const maxDuration = 900;

/**
 * Confirm a proposal SED AI prepared: re-checked as of now, then made as the
 * person pressing Confirm — through the app's own endpoint for that change.
 */

const bodySchema = z.object({
  /** Values changed on the card: field → editor value. */
  edits: z.record(z.string(), z.unknown()).optional(),
  /** Bulk: the records still ticked. */
  selected: z.array(z.string().uuid()).max(500).optional(),
  /** Critical actions: the typed confirmation words. */
  phrase: z.string().max(200).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await actionGuard();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "That action was not found." }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 422 });
  try {
    const card = await confirmAction({ id, ctx: guard.value.ctx, origin: requestOrigin(req), ...parsed.data });
    return NextResponse.json({ card });
  } catch (e) {
    return actionError(e, "The change could not be made.");
  }
}
