import { NextResponse } from "next/server";
import { requireDomains, domainsAuthError } from "@/lib/domains/guard";
import { domainSearchResponse } from "@/lib/domains/searchResponse";
import { takeDomainCheck, TOO_MANY_CHECKS } from "@/lib/domains/checkRate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/domains/check?q=&registrar= — the Check-a-name page: the same
 * answer as /api/domains/search (exact name first, then other endings, then
 * different names), for anyone with domains.view — sales on a call. Read only:
 * buying still needs domains.purchase. A per-person brake keeps registrar
 * calls in check.
 */
export async function GET(req: Request) {
  const auth = await requireDomains("view");
  if ("error" in auth) return domainsAuthError(auth.error);
  const url = new URL(req.url);
  if ((url.searchParams.get("q") ?? "").trim() && !takeDomainCheck(auth.userId)) {
    return NextResponse.json({ error: TOO_MANY_CHECKS }, { status: 429 });
  }
  return domainSearchResponse(url);
}
