import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { canTagLine, parseLineType, setLineType } from "@/lib/hitlist/line";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT /api/hitlist/:leadId/line { line_type: "direct" | "not_direct" | null }
 * — the HitList's one-click Direct Line / Not Direct Line tag
 * (lib/hitlist/line.ts). Anyone who can see the HitList may set it.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  const body = (await req.json().catch(() => null)) as { line_type?: unknown } | null;
  const value = parseLineType(body?.line_type);
  if (value === undefined) return NextResponse.json({ error: 'line_type must be "direct", "not_direct" or null.' }, { status: 400 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canTagLine(await getUserPermissions(user.id))) {
    return NextResponse.json({ error: "Only people who can see the HitList can tag leads there." }, { status: 403 });
  }
  const r = await setLineType(createAdminClient(), leadId, value, user.id);
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status ?? 500 });
  return NextResponse.json({ ok: true, line_type: value });
}
