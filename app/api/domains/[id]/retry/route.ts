import { NextResponse, after } from "next/server";
import { requireDomains, domainsAuthError } from "@/lib/domains/guard";
import { retryDomain } from "@/lib/domains/service";
import { processDomains } from "@/lib/domains/processor";
import { realPipelineDeps } from "@/lib/domains/deps";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/domains/[id]/retry — resume a stopped setup from the failed step. */
export async function POST(_req: Request, ctx: Ctx) {
  const auth = await requireDomains("manage");
  if ("error" in auth) return domainsAuthError(auth.error);
  const { id } = await ctx.params;
  const r = await retryDomain(auth.admin, id, auth.userId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const admin = auth.admin;
  after(() => processDomains(realPipelineDeps(admin), { onlyId: id, budgetMs: 240_000 }).then(() => undefined));
  return NextResponse.json({ domain: r.domain });
}
