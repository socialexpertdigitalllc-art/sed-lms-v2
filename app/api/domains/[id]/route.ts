import { NextResponse, after } from "next/server";
import { requireDomains, domainsAuthError, requireDomainRow } from "@/lib/domains/guard";
import { loadDomainDetail } from "@/lib/domains/detail";
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

/** GET /api/domains/[id] — the domain page's data: row + lead, activity, 30 days of checks. */
export async function GET(_req: Request, ctx: Ctx) {
  const auth = await requireDomains("view");
  if ("error" in auth) return domainsAuthError(auth.error);
  const { id } = await ctx.params;
  const detail = await loadDomainDetail(auth.admin, id);
  if (!detail) return NextResponse.json({ error: "Domain not found" }, { status: 404 });
  return NextResponse.json({ ...detail, canManage: auth.canManage, canPurchase: auth.canPurchase });
}

/**
 * DELETE /api/domains/[id] — forget a domain the dashboard no longer owns: one
 * the registrar stopped listing (moved, transferred out, deleted) or a failed
 * purchase. Nothing at the registrar is touched; the history is logged.
 */
export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await requireDomainRow("manage", (await ctx.params).id);
  if ("response" in g) return g.response;
  const { row, auth } = g;
  if (row.registrar_status !== "missing" && row.status !== "failed") {
    return NextResponse.json({ error: "Only a domain that left the registrar account (or a failed purchase) can be removed" }, { status: 409 });
  }
  const { error } = await auth.admin.from("client_domains").delete().eq("id", row.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await auth.admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "domain.removed",
    entity_type: "client_domain",
    entity_id: row.id,
    new_value: { domain: row.domain, registrar: row.registrar, registrar_status: row.registrar_status, status: row.status },
  });
  return NextResponse.json({ ok: true });
}
