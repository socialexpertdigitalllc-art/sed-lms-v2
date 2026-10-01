import { requireDomainRow, manageResponse } from "@/lib/domains/guard";
import { setForwarding } from "@/lib/domains/manage";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/domains/[id]/forwarding { redirectType: "301" | "302", redirectUrl } — send the whole domain to a URL. */
export async function PUT(req: Request, ctx: Ctx) {
  const g = await requireDomainRow("manage", (await ctx.params).id);
  if ("response" in g) return g.response;
  const body = (await req.json().catch(() => ({}))) as { redirectType?: unknown; redirectUrl?: unknown };
  if ((body.redirectType !== "301" && body.redirectType !== "302") || typeof body.redirectUrl !== "string") {
    return Response.json({ error: "redirectType (301 or 302) and redirectUrl are required" }, { status: 400 });
  }
  return manageResponse(
    await setForwarding(g.auth.admin, g.row, { redirectType: body.redirectType, redirectUrl: body.redirectUrl }, g.auth.userId),
  );
}

/** DELETE /api/domains/[id]/forwarding — stop forwarding. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await requireDomainRow("manage", (await ctx.params).id);
  if ("response" in g) return g.response;
  return manageResponse(await setForwarding(g.auth.admin, g.row, null, g.auth.userId));
}
