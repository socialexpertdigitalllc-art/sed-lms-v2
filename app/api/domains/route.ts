import { NextResponse } from "next/server";
import { requireDomains, domainsAuthError } from "@/lib/domains/guard";
import { cloudflareConfigured, registrarSandbox } from "@/lib/cloudflare/client";
import { hostingerConfigured } from "@/lib/hostinger/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/domains[?leadId=] — every client domain (or the one linked to a
 * lead), with the lead's name, plus what this user may do with them.
 */
export async function GET(req: Request) {
  const auth = await requireDomains("view");
  if ("error" in auth) return domainsAuthError(auth.error);
  const leadId = new URL(req.url).searchParams.get("leadId");

  let q = auth.admin
    .from("client_domains")
    .select("*, leads(business_name)")
    .order("created_at", { ascending: false });
  if (leadId) q = q.eq("lead_id", leadId).neq("status", "failed");
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({
    domains: data ?? [],
    canManage: auth.canManage,
    canPurchase: auth.canPurchase,
    cloudflareConfigured: cloudflareConfigured(),
    hostingerConfigured: hostingerConfigured(),
    sandbox: registrarSandbox(),
  });
}
