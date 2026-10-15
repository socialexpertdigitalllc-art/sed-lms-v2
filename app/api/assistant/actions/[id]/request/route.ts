import { NextResponse } from "next/server";
import { z } from "zod";
import { actionError, actionGuard } from "@/lib/assistant/actions/http";
import { requestApproval } from "@/lib/assistant/actions/run";
import { UUID_RE } from "@/lib/assistant/http";

export const runtime = "nodejs";

/**
 * "Ask an admin": send a proposal the person cannot run themselves to the
 * approvers — as they left the card (edits made, records unticked).
 */
const bodySchema = z.object({
  note: z.string().trim().max(500).optional(),
  edits: z.record(z.string(), z.unknown()).optional(),
  selected: z.array(z.string().uuid()).max(500).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await actionGuard();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "That action was not found." }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 422 });
  try {
    const { note, edits, selected } = parsed.data;
    return NextResponse.json({ card: await requestApproval(id, guard.value.ctx, note || null, { edits, selected }) });
  } catch (e) {
    return actionError(e);
  }
}
