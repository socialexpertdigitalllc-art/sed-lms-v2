import { NextResponse, after } from "next/server";
import { requireDomains, domainsAuthError } from "@/lib/domains/guard";
import { assignDomain, setDomainAutoRenew } from "@/lib/domains/service";
import { processDomains } from "@/lib/domains/processor";
import { realPipelineDeps } from "@/lib/domains/deps";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/domains/[id] { leadId?: string | null, autoRenew?: boolean }
 * Link / unlink a lead (linking an unassigned domain starts the automatic
 * setup; a `connected` one is only linked) or toggle auto-renew.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireDomains("manage");
  if ("error" in auth) return domainsAuthError(auth.error);
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { leadId?: unknown; autoRenew?: unknown };

  if (typeof body.autoRenew === "boolean") {
    const r = await setDomainAutoRenew(auth.admin, id, body.autoRenew, auth.userId);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ domain: r.domain });
  }
  if (body.leadId === null || typeof body.leadId === "string") {
    const r = await assignDomain(auth.admin, id, body.leadId === "" ? null : (body.leadId as string | null), auth.userId);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    if (r.kick) {
      const admin = auth.admin;
      after(() => processDomains(realPipelineDeps(admin), { onlyId: id, budgetMs: 240_000 }).then(() => undefined));
    }
    return NextResponse.json({ domain: r.domain });
  }
  return NextResponse.json({ error: "Nothing to change" }, { status: 422 });
}
