import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { subdomainExists } from "@/lib/template-engine/directadmin";
import { adoptSubdomain } from "@/lib/site-studio/deploy/manage";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/site-studio/deployments/adopt  body { subdomain }
 *
 * Track an untracked hosting subdomain as a board row (origin 'manual',
 * no lead) so id-keyed actions — shuffle, transfer, override — can run on it.
 */
export async function POST(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const body = (await req.json().catch(() => ({}))) as { subdomain?: unknown };
  const sub = typeof body.subdomain === "string" ? body.subdomain.trim().toLowerCase() : "";
  if (!sub || !/^[a-z0-9-]{1,63}$/.test(sub)) {
    return NextResponse.json({ error: "Invalid subdomain" }, { status: 422 });
  }
  if (!(await subdomainExists(sub))) {
    return NextResponse.json({ error: "Subdomain not found on the hosting" }, { status: 404 });
  }

  const admin = createAdminClient();
  const adopted = await adoptSubdomain(admin, sub, auth.userId);
  if ("error" in adopted) return NextResponse.json({ error: adopted.error }, { status: 502 });
  return NextResponse.json({ ok: true, deploymentId: adopted.row.id, url: adopted.row.url });
}
