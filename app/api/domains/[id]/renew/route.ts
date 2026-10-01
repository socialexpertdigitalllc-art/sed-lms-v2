import { requireDomainRow, manageResponse } from "@/lib/domains/guard";
import { renewNow } from "@/lib/domains/manage";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/domains/[id]/renew — renew for another year now. Spends money
 * (the company's default payment method), so it needs domains.purchase.
 * Cloudflare can't renew over its API: the answer carries the page to do it on.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const g = await requireDomainRow("purchase", (await ctx.params).id);
  if ("response" in g) return g.response;
  return manageResponse(await renewNow(g.auth.admin, g.row, g.auth.userId));
}
