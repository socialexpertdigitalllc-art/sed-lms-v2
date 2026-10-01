import { requireDomainRow, manageResponse } from "@/lib/domains/guard";
import { readRegistrarSettings, updateRegistrarSettings } from "@/lib/domains/manage";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/domains/[id]/registrar — live settings from the registrar (lock, privacy, nameservers, forwarding, move). */
export async function GET(_req: Request, ctx: Ctx) {
  const g = await requireDomainRow("view", (await ctx.params).id);
  if ("response" in g) return g.response;
  return manageResponse(await readRegistrarSettings(g.auth.admin, g.row));
}

/** PATCH /api/domains/[id]/registrar { locked?, privacy?, nameservers? } */
export async function PATCH(req: Request, ctx: Ctx) {
  const g = await requireDomainRow("manage", (await ctx.params).id);
  if ("response" in g) return g.response;
  const body = (await req.json().catch(() => ({}))) as { locked?: unknown; privacy?: unknown; nameservers?: unknown };
  const patch: { locked?: boolean; privacy?: boolean; nameservers?: string[] } = {};
  if (typeof body.locked === "boolean") patch.locked = body.locked;
  if (typeof body.privacy === "boolean") patch.privacy = body.privacy;
  if (Array.isArray(body.nameservers) && body.nameservers.every((n) => typeof n === "string")) patch.nameservers = body.nameservers as string[];
  if (!Object.keys(patch).length) return Response.json({ error: "Nothing to change" }, { status: 422 });
  return manageResponse(await updateRegistrarSettings(g.auth.admin, g.row, patch, g.auth.userId));
}
