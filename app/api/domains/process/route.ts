import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cloudflareConfigured } from "@/lib/cloudflare/client";
import { hostingerConfigured } from "@/lib/hostinger/client";
import { processDomains } from "@/lib/domains/processor";
import { realPipelineDeps } from "@/lib/domains/deps";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/domains/process — the domain pipeline's background sweep, called
 * every minute by the instrumentation poller (prod only: WGE_POLLERS_DISABLED
 * keeps dev boxes out). Same x-wge-secret contract as the other processors,
 * and like them it MUST be in lib/supabase/middleware.ts's public list.
 */
export async function POST(req: Request) {
  const expected = process.env.WGE_PROCESSOR_SECRET;
  if (!expected) return NextResponse.json({ error: "WGE_PROCESSOR_SECRET is not configured" }, { status: 503 });
  if (req.headers.get("x-wge-secret") !== expected) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!cloudflareConfigured() || !hostingerConfigured()) return NextResponse.json({ processed: [], skipped: "not configured" });

  const processed = await processDomains(realPipelineDeps(createAdminClient()), { budgetMs: 240_000 });
  return NextResponse.json({ processed });
}
