import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";

export const runtime = "nodejs";
export const maxDuration = 60;

const VALID_STATUSES = new Set(["live", "taken_down", "failed"]);

/**
 * GET /api/site-studio/deployments — every row in `studio_deployments`,
 * joined with the lead's business name, newest-deployed first. An optional
 * `?status=` filters to one of the three column values; anything else is
 * ignored (the board's own "All" chip omits the param entirely).
 *
 * This board (Task 10) is deliberately the ONE place that will also show
 * `origin:'v2_import'` rows once Phase 4b seeds them at cutover — nothing
 * here special-cases `origin`, so those rows just show up like any other.
 */
export async function GET(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  const admin = createAdminClient();
  let query = admin
    .from("studio_deployments")
    .select(
      "id, lead_id, run_id, subdomain, docroot, url, status, origin, deployed_at, taken_down_at, deployed_by, created_at, updated_at, leads(business_name)",
    )
    .order("deployed_at", { ascending: false });

  if (status && VALID_STATUSES.has(status)) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ deployments: data ?? [] });
}
