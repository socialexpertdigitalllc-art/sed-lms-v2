import { requireDomainRow, manageResponse } from "@/lib/domains/guard";
import { revealAuthCode } from "@/lib/domains/manage";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/domains/[id]/auth-code — the transfer (EPP) code; each request makes a new one. Logged. */
export async function POST(_req: Request, ctx: Ctx) {
  const g = await requireDomainRow("manage", (await ctx.params).id);
  if ("response" in g) return g.response;
  return manageResponse(await revealAuthCode(g.auth.admin, g.row, g.auth.userId));
}
