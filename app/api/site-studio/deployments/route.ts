import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { daConfigured, ensureWildcardDns, listSubdomains } from "@/lib/template-engine/directadmin";
import { hostingerConfigured, listWebsites } from "@/lib/hostinger/client";
import { buildBoard, filterByView, type HostedSite, type TrackedRow } from "@/lib/site-studio/deploy/categorize";
import { isProtectedDomain } from "@/lib/site-studio/deploy/protected";

// One shot per server process: make sure *.DA_DOMAIN resolves via a wildcard
// A record, so fresh subdomains don't sit behind DNS propagation. Fail-soft —
// a DNS API hiccup must never break the board.
let wildcardEnsured: Promise<void> | null = null;
function ensureWildcardOnce(): void {
  if (!wildcardEnsured && daConfigured()) {
    wildcardEnsured = ensureWildcardDns()
      .then((r) => {
        if (r === "added") console.log("[deployments] wildcard DNS record added for *." + (process.env.DA_DOMAIN ?? ""));
        if (r === "failed") console.warn("[deployments] could not verify/add the wildcard DNS record");
      })
      .catch(() => {});
  }
}

export const runtime = "nodejs";
export const maxDuration = 60;

const LEGACY_STATUSES = new Set(["live", "taken_down", "failed"]);
const VIEWS = new Set(["all", "ready", "manual", "other", "live"]);

// The DirectAdmin subdomain listing takes seconds on a 700-subdomain account
// and Hostinger adds another round-trip — far too slow to pay on every tab
// click. One in-process cache (single pm2 process) with a short TTL keeps the
// board snappy; mutating routes don't invalidate it, so a just-created
// subdomain may take up to TTL to appear as "untracked" (its tracked DB row
// shows immediately, which is what the board leads with anyway).
const HOSTING_CACHE_TTL_MS = 60_000;
let hostingCache: { at: number; subs: string[] | null; domains: HostedSite[] | null } | null = null;

/** The Live tab is what the hosting actually SERVES — every website on the
 *  plan (with its type, so WordPress sites get no file actions), not the
 *  registrar portfolio: a registered domain with no website isn't a live site,
 *  and a client-owned domain pointed at our hosting is one. */
async function listHostedSites(): Promise<HostedSite[] | null> {
  const websites = await listWebsites();
  if (websites === null) return null;
  return websites
    .filter((w) => w.domain && !w.domain.toLowerCase().endsWith(".hostingersite.com"))
    .map((w) => ({ domain: w.domain.toLowerCase(), siteType: w.website_type ?? null }));
}

async function fetchHostingInventory(): Promise<{ subs: string[] | null; domains: HostedSite[] | null }> {
  const now = Date.now();
  if (hostingCache && now - hostingCache.at < HOSTING_CACHE_TTL_MS) {
    return hostingCache;
  }
  const [subs, domains] = await Promise.all([
    daConfigured() ? listSubdomains() : Promise.resolve(null),
    hostingerConfigured() ? listHostedSites() : Promise.resolve(null),
  ]);
  // Don't cache a failed listing — retry on the next request instead.
  if (subs !== null || domains !== null) hostingCache = { at: now, subs, domains };
  return { subs, domains };
}

/**
 * GET /api/site-studio/deployments — the unified deployments board.
 *
 * Default (`?view=`): DB rows merged with hosting truth — every DirectAdmin
 * staging subdomain and every Hostinger domain, categorized
 * (ready / manual / other / live). Hosting fetch failures degrade to DB rows
 * only, flagged via `hostingWarning`.
 *
 * Legacy (`?status=`): plain `studio_deployments` rows, kept for any old
 * consumers of the pre-unification board shape.
 */
export async function GET(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const view = searchParams.get("view");

  const admin = createAdminClient();
  let query = admin
    .from("studio_deployments")
    .select(
      "id, lead_id, run_id, subdomain, docroot, url, status, origin, deployed_at, taken_down_at, deployed_by, created_at, updated_at, leads(business_name, status)",
    )
    .order("deployed_at", { ascending: false });

  if (status && LEGACY_STATUSES.has(status)) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Legacy shape for pre-unification consumers.
  if (!view) return NextResponse.json({ deployments: data ?? [] });

  const daDomain = process.env.DA_DOMAIN ?? "";
  // `fast=1` = first-paint request: DB rows only, no hosting round-trips.
  // The client follows up with a full request that merges hosting truth.
  const fast = searchParams.get("fast") === "1";
  const { subs, domains } = fast
    ? { subs: null as string[] | null, domains: null as HostedSite[] | null }
    : await fetchHostingInventory();

  ensureWildcardOnce();

  const board = buildBoard((data ?? []) as unknown as TrackedRow[], subs, domains, daDomain).map((r) => {
    if (!r.isCustomDomain) return { ...r, protected: false };
    let host: string | null = null;
    try {
      host = new URL(r.url).hostname;
    } catch {}
    return { ...r, protected: isProtectedDomain(host) };
  });
  const warnings: string[] = [];
  if (!fast && daConfigured() && subs === null) warnings.push("Could not list hosting subdomains — showing tracked rows only.");
  if (!fast && hostingerConfigured() && domains === null) warnings.push("Could not list the hosted websites.");

  return NextResponse.json({
    rows: filterByView(board, VIEWS.has(view) ? view : "all"),
    counts: {
      all: board.filter((r) => !r.isCustomDomain).length,
      ready: board.filter((r) => r.category === "ready").length,
      manual: board.filter((r) => r.category === "manual").length,
      other: board.filter((r) => r.category === "other").length,
      live: board.filter((r) => r.category === "live").length,
    },
    daDomain,
    hostingerConfigured: hostingerConfigured(),
    hostingWarning: warnings.length ? warnings.join(" ") : null,
    hostingSynced: !fast,
  });
}
