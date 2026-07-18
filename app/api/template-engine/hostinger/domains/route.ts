import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { hostingerConfigured, listDomains } from "@/lib/hostinger/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/template-engine/hostinger/domains — the account's registered domains,
// for the "transfer to custom domain" picker. Active domains only, sorted.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.deploy")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!hostingerConfigured()) return NextResponse.json({ domains: [], configured: false });

  const domains = (await listDomains())
    .filter((d) => d.status === "active")
    .map((d) => ({ domain: d.domain, expires_at: d.expires_at }))
    .sort((a, b) => a.domain.localeCompare(b.domain));

  return NextResponse.json({ domains, configured: true });
}
