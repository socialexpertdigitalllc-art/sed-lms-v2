import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { actingAs, canActForAgent } from "@/lib/teams/closers";
import { isLogoTableMissing, LogoError, LOGO_MIGRATION_MESSAGE } from "./store";

/**
 * Who may use the logo generator on a lead: exactly who may edit the lead's
 * logo link — leads.edit, and the lead is theirs, or they see every lead, or
 * they are the closer acting for its agent. The same rules as
 * PATCH /api/leads/[id]; the routes use the service role, so they are
 * re-checked here by hand.
 */

export const LOGO_LEAD_COLUMNS = "id, business_name, logo_link, agent_id, services, category, about_business, color_scheme";

export interface LogoLead {
  id: string;
  business_name: string;
  logo_link: string | null;
  agent_id: string | null;
  services: string[] | null;
  category: string | null;
  about_business: string | null;
  color_scheme: string | null;
}

export type LogoAccess =
  | { ok: true; userId: string; admin: SupabaseClient; lead: LogoLead; actingAs: ReturnType<typeof actingAs> }
  | { ok: false; response: NextResponse };

const no = (error: string, status: number): LogoAccess => ({ ok: false, response: NextResponse.json({ error }, { status }) });

export async function logoAccess(leadId: string): Promise<LogoAccess> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return no("Unauthorized", 401);
  const perms = await getUserPermissions(user.id);
  if (!perms.has("leads.edit")) return no("You don't have permission to edit leads.", 403);

  const admin = createAdminClient();
  const { data } = await admin.from("leads").select(LOGO_LEAD_COLUMNS).eq("id", leadId).is("deleted_at", null).maybeSingle();
  const lead = data as LogoLead | null;
  if (!lead) return no("Lead not found", 404);
  if (!perms.has("leads.view_all") && lead.agent_id !== user.id && !(await canActForAgent(admin, user.id, lead.agent_id))) {
    return no("You can only modify your own leads.", 403);
  }
  return { ok: true, userId: user.id, admin, lead, actingAs: actingAs(user.id, lead.agent_id) };
}

/** Any failure as a response a person can read. */
export function logoErrorResponse(e: unknown): NextResponse {
  if (e instanceof LogoError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (isLogoTableMissing(e)) return NextResponse.json({ error: LOGO_MIGRATION_MESSAGE }, { status: 503 });
  console.error("[logos]", e);
  return NextResponse.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status: 500 });
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
