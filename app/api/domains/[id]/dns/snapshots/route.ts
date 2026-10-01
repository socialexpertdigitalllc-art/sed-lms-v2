import { requireDomainRow, manageResponse } from "@/lib/domains/guard";
import { listDnsSnapshots, restoreDnsSnapshot } from "@/lib/domains/manage";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/domains/[id]/dns/snapshots — Hostinger's saved versions of the zone. */
export async function GET(_req: Request, ctx: Ctx) {
  const g = await requireDomainRow("view", (await ctx.params).id);
  if ("response" in g) return g.response;
  return manageResponse(await listDnsSnapshots(g.row));
}

/** POST /api/domains/[id]/dns/snapshots { snapshotId } — put the zone back as it was. */
export async function POST(req: Request, ctx: Ctx) {
  const g = await requireDomainRow("manage", (await ctx.params).id);
  if ("response" in g) return g.response;
  const body = (await req.json().catch(() => ({}))) as { snapshotId?: unknown };
  if (typeof body.snapshotId !== "number") return Response.json({ error: "snapshotId is required" }, { status: 400 });
  return manageResponse(await restoreDnsSnapshot(g.auth.admin, g.row, body.snapshotId, g.auth.userId));
}
