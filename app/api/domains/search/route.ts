import { NextResponse } from "next/server";
import { requireDomains, domainsAuthError } from "@/lib/domains/guard";
import { cloudflareConfigured } from "@/lib/cloudflare/client";
import { hostingerConfigured } from "@/lib/hostinger/client";
import { searchOffers } from "@/lib/domains/service";
import type { DomainRegistrar } from "@/lib/domains/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/domains/search?q=&registrar=cloudflare|hostinger — availability and
 * price for a phrase ("jj remodeling atlanta") or an exact name. Discovery
 * only: the purchase re-checks on the server right before buying.
 */
export async function GET(req: Request) {
  const auth = await requireDomains("purchase");
  if ("error" in auth) return domainsAuthError(auth.error);
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const registrar: DomainRegistrar = url.searchParams.get("registrar") === "hostinger" ? "hostinger" : "cloudflare";
  if (!q) return NextResponse.json({ results: [] });
  if (registrar === "cloudflare" && !cloudflareConfigured()) {
    return NextResponse.json({ error: "Cloudflare is not configured." }, { status: 422 });
  }
  if (registrar === "hostinger" && !hostingerConfigured()) {
    return NextResponse.json({ error: "Hostinger is not configured." }, { status: 422 });
  }
  const results = await searchOffers(q, registrar);
  if (results === null) return NextResponse.json({ error: `Could not reach ${registrar === "cloudflare" ? "Cloudflare" : "Hostinger"} — try again.` }, { status: 502 });
  return NextResponse.json({ results, registrar });
}
