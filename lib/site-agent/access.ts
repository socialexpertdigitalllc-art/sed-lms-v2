// lib/site-agent/access.ts
/**
 * One gate for every /api/site-agent/runs/[id]/* route: session + permission
 * (ALLOWED_PERMS pattern — tickets.resolve admits tech users without
 * studio.manage, exactly like the manual download/override buttons) + the
 * ticket-object scope (canActOnTicket) so a tech user can only reach runs on
 * tickets they could act on anyway. studio.manage bypasses scoping (board
 * operators see everything, as on the deployments board).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { allowedTicketScope, canActOnTicket } from "@/lib/tickets/scope";
import type { AgentRunRow } from "./types";

const ALLOWED_PERMS = ["studio.manage", "tickets.resolve"];

export type AgentRunAccess =
  | { run: AgentRunRow; userId: string; perms: Set<string> }
  | { error: NextResponse; status: 401 | 403 | 404 };

export async function agentRunAccess(admin: SupabaseClient, runId: string): Promise<AgentRunAccess> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), status: 401 };
  const perms = await getUserPermissions(user.id);
  if (!ALLOWED_PERMS.some((p) => perms.has(p))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), status: 403 };
  }

  const { data: run } = await admin
    .from("site_agent_runs")
    .select("id, ticket_id, lead_id, site_host, status, claim_id, conversation_id, instructions, files, output_tail, summary, usage, error, created_by, created_at, updated_at")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return { error: NextResponse.json({ error: "Run not found" }, { status: 404 }), status: 404 };

  if (!perms.has("studio.manage")) {
    // Object-level scope rides the ticket; a run whose ticket is gone is
    // operator territory only.
    const ticketId = (run as AgentRunRow).ticket_id;
    if (!ticketId) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), status: 403 };
    const { data: ticket } = await admin
      .from("lead_tickets")
      .select("id, created_by, lead_id, assigned_to")
      .eq("id", ticketId)
      .maybeSingle();
    if (!ticket) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), status: 403 };
    const scope = await allowedTicketScope(admin, user.id, perms);
    if (!canActOnTicket(ticket, user.id, scope)) {
      return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), status: 403 };
    }
  }

  return { run: run as AgentRunRow, userId: user.id, perms };
}
