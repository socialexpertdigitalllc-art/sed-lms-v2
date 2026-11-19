import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { isSiteDeveloper } from "@/lib/leads/siteReview";
import { markWebsiteSent } from "@/lib/leads/sent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/:id/sent — the SENT button beside the deadline timer: the
 * website went to the client, the lead turns Ready (lib/leads/sent.ts).
 * Tech and Admin (tickets.resolve / studio.manage).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSiteDeveloper(await getUserPermissions(user.id))) {
    return NextResponse.json({ error: "Only Tech and Admin can mark a website sent." }, { status: 403 });
  }
  const r = await markWebsiteSent(createAdminClient(), { leadId: id, actorId: user.id });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
