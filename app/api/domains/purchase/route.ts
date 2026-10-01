import { NextResponse, after } from "next/server";
import { requireDomains, domainsAuthError } from "@/lib/domains/guard";
import { cloudflareConfigured } from "@/lib/cloudflare/client";
import { hostingerConfigured } from "@/lib/hostinger/client";
import { purchaseDomain } from "@/lib/domains/service";
import { processDomains } from "@/lib/domains/processor";
import { realPipelineDeps } from "@/lib/domains/deps";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/domains/purchase { domain, registrar, leadId?, expectedCents }
 * Buys a domain with the company payment method — NON-REFUNDABLE. Refuses
 * unless the server-side price is exactly `expectedCents` (what the buyer
 * confirmed). Then the setup pipeline starts at once in the background.
 */
export async function POST(req: Request) {
  const auth = await requireDomains("purchase");
  if ("error" in auth) return domainsAuthError(auth.error);

  const body = (await req.json().catch(() => ({}))) as {
    domain?: unknown;
    registrar?: unknown;
    leadId?: unknown;
    expectedCents?: unknown;
  };
  const registrar = body.registrar === "hostinger" ? "hostinger" : body.registrar === "cloudflare" ? "cloudflare" : null;
  if (!registrar) return NextResponse.json({ error: "Pick Cloudflare or Hostinger" }, { status: 422 });
  if (typeof body.domain !== "string" || !body.domain.trim()) return NextResponse.json({ error: "Pick a domain" }, { status: 422 });
  if (typeof body.expectedCents !== "number" || !Number.isInteger(body.expectedCents) || body.expectedCents <= 0) {
    return NextResponse.json({ error: "Confirm the price first" }, { status: 422 });
  }
  const leadId = typeof body.leadId === "string" && body.leadId ? body.leadId : null;
  if (registrar === "cloudflare" && !cloudflareConfigured()) {
    return NextResponse.json({ error: "Cloudflare is not configured." }, { status: 422 });
  }
  if (!hostingerConfigured()) return NextResponse.json({ error: "Hostinger is not configured." }, { status: 422 });

  const r = await purchaseDomain(auth.admin, {
    domain: body.domain,
    registrar,
    leadId,
    expectedCents: body.expectedCents,
    actorId: auth.userId,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  // registration polling, DNS, hosting, SSL and go-live continue in the background
  const admin = auth.admin;
  after(() => processDomains(realPipelineDeps(admin), { onlyId: r.domain.id, budgetMs: 240_000 }).then(() => undefined));
  return NextResponse.json({ domain: r.domain });
}
