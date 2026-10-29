import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { parsePriority, removeHitlist, setHitlist } from "@/lib/hitlist/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The HitList star (lib/hitlist/store.ts). PUT {priority: 1–5} adds the lead
 * or changes its stars; DELETE takes it off. Both need hitlist.manage (Admin).
 */
type Guarded = { response: NextResponse } | { response?: undefined; userId: string; admin: ReturnType<typeof createAdminClient> };

async function guard(leadId: string): Promise<Guarded> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const admin = createAdminClient();
  // In parallel: the star must feel instant.
  const [perms, { data: lead }] = await Promise.all([
    getUserPermissions(user.id),
    admin.from("leads").select("id").eq("id", leadId).is("deleted_at", null).maybeSingle(),
  ]);
  if (!perms.has("hitlist.manage")) return { response: NextResponse.json({ error: "Only admins can change the hit list." }, { status: 403 }) };
  if (!lead) return { response: NextResponse.json({ error: "Lead not found" }, { status: 404 }) };
  return { userId: user.id, admin };
}

export async function PUT(req: Request, { params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  const body = (await req.json().catch(() => null)) as { priority?: unknown } | null;
  const priority = parsePriority(body?.priority);
  if (priority == null) return NextResponse.json({ error: "Priority must be 1 to 5 stars." }, { status: 400 });
  const g = await guard(leadId);
  if (g.response) return g.response;
  const r = await setHitlist(g.admin, leadId, priority, g.userId);
  if (r.error) return NextResponse.json({ error: r.error }, { status: 500 });
  return NextResponse.json({ leadId, priority });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  const g = await guard(leadId);
  if (g.response) return g.response;
  const r = await removeHitlist(g.admin, leadId, g.userId);
  if (r.error) return NextResponse.json({ error: r.error }, { status: 500 });
  return NextResponse.json({ leadId, priority: null });
}
