import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { finalizeSiteReview, isSiteDeveloper } from "@/lib/leads/siteReview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/:id/site-review/finalize — the developer has checked the
 * published website and it is ready: its link becomes the lead's website link
 * for everyone, and the agent and closer hear "Website live"
 * (lib/leads/siteReview.ts). Developers only (tickets.resolve / studio.manage).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!isSiteDeveloper(perms)) {
    return NextResponse.json({ error: "Only a developer can finalize a website." }, { status: 403 });
  }
  const r = await finalizeSiteReview(createAdminClient(), { leadId: id, actorId: user.id });
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, url: r.url });
}
