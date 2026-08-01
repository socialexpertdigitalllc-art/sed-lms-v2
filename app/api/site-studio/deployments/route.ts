import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { daConfigured, listSubdomains } from "@/lib/template-engine/directadmin";
import { hostingerConfigured, listDomains } from "@/lib/hostinger/client";
import { buildBoard, filterByView, type TrackedRow } from "@/lib/site-studio/deploy/categorize";

export const runtime = "nodejs";
export const maxDuration = 60;

const LEGACY_STATUSES = new Set(["live", "taken_down", "failed"]);
const VIEWS = new Set(["all", "ready", "manual", "other", "live"]);

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
  const [subs, domains] = await Promise.all([
    daConfigured() ? listSubdomains() : Promise.resolve(null),
    hostingerConfigured()
      ? listDomains().then((ds) => ds.filter((d) => (d.status ?? "").toLowerCase() === "active").map((d) => d.domain))
      : Promise.resolve(null),
  ]);

  const board = buildBoard((data ?? []) as unknown as TrackedRow[], subs, domains, daDomain);
  const warnings: string[] = [];
  if (daConfigured() && subs === null) warnings.push("Could not list hosting subdomains — showing tracked rows only.");
  if (hostingerConfigured() && domains === null) warnings.push("Could not list hosting domains.");

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
  });
}
