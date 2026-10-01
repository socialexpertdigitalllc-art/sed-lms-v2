import { requireDomainRow } from "@/lib/domains/guard";
import { checkDomainHealth } from "@/lib/domains/health";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/domains/[id]/health — check the site now (DNS, certificate, HTTPS). Read-only toward the site. */
export async function POST(_req: Request, ctx: Ctx) {
  const g = await requireDomainRow("view", (await ctx.params).id);
  if ("response" in g) return g.response;
  const health = await checkDomainHealth(g.auth.admin, g.row);
  if (!health) return Response.json({ error: "Couldn't look up the domain's DNS — try again in a minute" }, { status: 503 });
  return Response.json({ health });
}
