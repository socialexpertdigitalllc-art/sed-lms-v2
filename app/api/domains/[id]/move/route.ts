import { requireDomainRow, manageResponse } from "@/lib/domains/guard";
import { cancelMove, startMove } from "@/lib/domains/manage";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/domains/[id]/move { email } — give the domain to another Hostinger account (e.g. the client's). */
export async function POST(req: Request, ctx: Ctx) {
  const g = await requireDomainRow("manage", (await ctx.params).id);
  if ("response" in g) return g.response;
  const body = (await req.json().catch(() => ({}))) as { email?: unknown };
  if (typeof body.email !== "string") return Response.json({ error: "email is required" }, { status: 400 });
  return manageResponse(await startMove(g.auth.admin, g.row, body.email, g.auth.userId));
}

/** DELETE /api/domains/[id]/move — cancel a move that hasn't been accepted yet. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await requireDomainRow("manage", (await ctx.params).id);
  if ("response" in g) return g.response;
  return manageResponse(await cancelMove(g.auth.admin, g.row, g.auth.userId));
}
