import { requireDomainRow, manageResponse } from "@/lib/domains/guard";
import { changeDns, listDns, type DnsInput, type DnsRow } from "@/lib/domains/manage";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/domains/[id]/dns — the domain's DNS records, from its registrar. */
export async function GET(_req: Request, ctx: Ctx) {
  const g = await requireDomainRow("view", (await ctx.params).id);
  if ("response" in g) return g.response;
  return manageResponse(await listDns(g.auth.admin, g.row));
}

function asInput(v: unknown): DnsInput | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.type !== "string" || typeof o.name !== "string" || typeof o.content !== "string" || typeof o.ttl !== "number") return null;
  return {
    type: o.type,
    name: o.name,
    content: o.content,
    ttl: o.ttl,
    priority: typeof o.priority === "number" ? o.priority : null,
    proxied: typeof o.proxied === "boolean" ? o.proxied : null,
  };
}

function asRow(v: unknown): DnsRow | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.type !== "string" || typeof o.name !== "string" || typeof o.raw !== "string") return null;
  return o as unknown as DnsRow;
}

/**
 * POST /api/domains/[id]/dns { original?: DnsRow, next?: DnsInput } — add
 * (next only), change (both) or delete (original only) one record.
 */
export async function POST(req: Request, ctx: Ctx) {
  const g = await requireDomainRow("manage", (await ctx.params).id);
  if ("response" in g) return g.response;
  const body = (await req.json().catch(() => ({}))) as { original?: unknown; next?: unknown };
  const original = body.original === undefined || body.original === null ? null : asRow(body.original);
  const next = body.next === undefined || body.next === null ? null : asInput(body.next);
  if ((body.original && !original) || (body.next && !next)) return Response.json({ error: "Malformed record" }, { status: 400 });
  return manageResponse(await changeDns(g.auth.admin, g.row, { original, next }, g.auth.userId));
}
