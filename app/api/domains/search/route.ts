import { requireDomains, domainsAuthError } from "@/lib/domains/guard";
import { domainSearchResponse } from "@/lib/domains/searchResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/domains/search?q=&registrar=cloudflare|hostinger — availability and
 * price for a phrase ("jj remodeling atlanta") or an exact name. Three groups,
 * never mixed: `exact` (what was typed, as one name — .com when no ending was
 * typed — checked authoritatively), `otherEndings` (same name, other
 * extensions) and `similar` (different names). `results` is all of them in
 * that order. Discovery only: the purchase re-checks right before buying.
 * The buying screen's search; /api/domains/check is the same answer for
 * anyone with domains.view.
 */
export async function GET(req: Request) {
  const auth = await requireDomains("purchase");
  if ("error" in auth) return domainsAuthError(auth.error);
  return domainSearchResponse(new URL(req.url));
}
