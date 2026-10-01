import { NextResponse } from "next/server";
import { requireDomains, domainsAuthError } from "@/lib/domains/guard";
import { cloudflareConfigured } from "@/lib/cloudflare/client";
import { hostingerConfigured } from "@/lib/hostinger/client";
import { importCloudflareDomains } from "@/lib/domains/import";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/domains/import — pull the Cloudflare account's domains into the
 * dashboard. Ones already hosted on Hostinger come in as `connected` (set up
 * by hand — never touched again); the rest are `unassigned`. Re-running only
 * refreshes expiry / auto-renew.
 */
export async function POST() {
  const auth = await requireDomains("manage");
  if ("error" in auth) return domainsAuthError(auth.error);
  if (!cloudflareConfigured()) {
    return NextResponse.json({ error: "Cloudflare is not configured (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID)." }, { status: 422 });
  }
  if (!hostingerConfigured()) return NextResponse.json({ error: "Hostinger is not configured." }, { status: 422 });

  const r = await importCloudflareDomains(auth.admin, auth.userId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  return NextResponse.json(r.summary);
}
