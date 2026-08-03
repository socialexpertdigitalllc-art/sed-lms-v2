import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { subdomainExists } from "@/lib/template-engine/directadmin";
import { hostingerConfigured } from "@/lib/hostinger/client";
import { adoptDomain, adoptSubdomain } from "@/lib/site-studio/deploy/manage";

export const runtime = "nodejs";
export const maxDuration = 60;

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * POST /api/site-studio/deployments/adopt  body { subdomain } | { domain }
 *
 * Track an untracked hosting site as a board row (origin 'manual', no lead)
 * so id-keyed actions — shuffle, transfer, override, takedown — can run on
 * it. `subdomain` = a *.DA_DOMAIN staging label; `domain` = a custom addon
 * domain on the Hostinger plan.
 */
export async function POST(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const body = (await req.json().catch(() => ({}))) as { subdomain?: unknown; domain?: unknown };
  const sub = typeof body.subdomain === "string" ? body.subdomain.trim().toLowerCase() : "";
  const domain = typeof body.domain === "string" ? body.domain.trim().toLowerCase() : "";
  const admin = createAdminClient();

  if (domain) {
    if (!DOMAIN_RE.test(domain)) return NextResponse.json({ error: "Invalid domain" }, { status: 422 });
    if (domain === (process.env.DA_DOMAIN ?? "").toLowerCase()) {
      return NextResponse.json({ error: "The staging apex is infrastructure, not a client site" }, { status: 422 });
    }
    if (!hostingerConfigured()) return NextResponse.json({ error: "Hostinger is not configured." }, { status: 422 });
    const adopted = await adoptDomain(admin, domain, auth.userId);
    if ("error" in adopted) return NextResponse.json({ error: adopted.error }, { status: 502 });
    return NextResponse.json({ ok: true, deploymentId: adopted.row.id, url: adopted.row.url });
  }

  if (!sub || !/^[a-z0-9-]{1,63}$/.test(sub)) {
    return NextResponse.json({ error: "Invalid subdomain" }, { status: 422 });
  }
  if (!(await subdomainExists(sub))) {
    return NextResponse.json({ error: "Subdomain not found on the hosting" }, { status: 404 });
  }
  const adopted = await adoptSubdomain(admin, sub, auth.userId);
  if ("error" in adopted) return NextResponse.json({ error: adopted.error }, { status: 502 });
  return NextResponse.json({ ok: true, deploymentId: adopted.row.id, url: adopted.row.url });
}
