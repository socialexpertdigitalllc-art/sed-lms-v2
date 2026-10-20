import { NextResponse } from "next/server";
import { requireDomains, domainsAuthError } from "@/lib/domains/guard";
import { cloudflareConfigured } from "@/lib/cloudflare/client";
import { hostingerConfigured } from "@/lib/hostinger/client";
import { searchDomainNames } from "@/lib/domains/service";
import type { DomainRegistrar } from "@/lib/domains/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/domains/search?q=&registrar=cloudflare|hostinger — availability and
 * price for a phrase ("jj remodeling atlanta") or an exact name. Three groups,
 * never mixed: `exact` (what was typed, as one name — .com when no ending was
 * typed — checked authoritatively), `otherEndings` (same name, other
 * extensions) and `similar` (different names). `results` is all of them in
 * that order. Discovery only: the purchase re-checks right before buying.
 */
export async function GET(req: Request) {
  const auth = await requireDomains("purchase");
  if ("error" in auth) return domainsAuthError(auth.error);
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const registrar: DomainRegistrar = url.searchParams.get("registrar") === "hostinger" ? "hostinger" : "cloudflare";
  if (!q) return NextResponse.json({ results: [], exact: null, otherEndings: [], similar: [] });
  if (registrar === "cloudflare" && !cloudflareConfigured()) {
    return NextResponse.json({ error: "Cloudflare is not configured." }, { status: 422 });
  }
  if (registrar === "hostinger" && !hostingerConfigured()) {
    return NextResponse.json({ error: "Hostinger is not configured." }, { status: 422 });
  }
  const found = await searchDomainNames(q, registrar);
  if (found === null) return NextResponse.json({ error: `Could not reach ${registrar === "cloudflare" ? "Cloudflare" : "Hostinger"} — try again.` }, { status: 502 });
  const results = [...(found.exact?.offer ? [found.exact.offer] : []), ...found.otherEndings, ...found.similar];
  return NextResponse.json({ ...found, results, registrar });
}
