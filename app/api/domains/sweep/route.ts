import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cloudflareConfigured } from "@/lib/cloudflare/client";
import { hostingerConfigured } from "@/lib/hostinger/client";
import { importAllDomains } from "@/lib/domains/import";
import { healthSweep } from "@/lib/domains/health";

export const runtime = "nodejs";
export const maxDuration = 300;

const SYNC_EVERY_MS = 6 * 3_600_000;

/**
 * POST /api/domains/sweep — the domains' background round, called every 15
 * minutes by the instrumentation poller (prod only): a registrar sync when the
 * last one is over six hours old (renewal alerts ride on it), then the site
 * health checks that are due. Same x-wge-secret contract as the processors,
 * and like them it MUST be in lib/supabase/middleware.ts's public list.
 */
export async function POST(req: Request) {
  const expected = process.env.WGE_PROCESSOR_SECRET;
  if (!expected) return NextResponse.json({ error: "WGE_PROCESSOR_SECRET is not configured" }, { status: 503 });
  if (req.headers.get("x-wge-secret") !== expected) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hostingerConfigured()) return NextResponse.json({ skipped: "not configured" });

  const admin = createAdminClient();
  const { data } = await admin
    .from("client_domains")
    .select("synced_at")
    .not("synced_at", "is", null)
    .order("synced_at", { ascending: false })
    .limit(1);
  const last = (data?.[0] as { synced_at: string } | undefined)?.synced_at ?? null;
  let synced = false;
  if (!last || Date.now() - Date.parse(last) > SYNC_EVERY_MS) {
    const r = await importAllDomains(admin, null, { cloudflare: cloudflareConfigured() });
    synced = r.ok;
  }
  const health = await healthSweep(admin, { budgetMs: 60_000 });
  return NextResponse.json({ synced, checked: health.checked });
}
