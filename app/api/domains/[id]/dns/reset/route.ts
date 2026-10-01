import { requireDomainRow, manageResponse } from "@/lib/domains/guard";
import { resetDns } from "@/lib/domains/manage";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/domains/[id]/dns/reset — Hostinger's default records back (email records kept). */
export async function POST(_req: Request, ctx: Ctx) {
  const g = await requireDomainRow("manage", (await ctx.params).id);
  if ("response" in g) return g.response;
  return manageResponse(await resetDns(g.auth.admin, g.row, g.auth.userId));
}
