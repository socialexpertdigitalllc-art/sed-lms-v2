import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { allowedTicketScope, canActOnTicket } from "@/lib/tickets/scope";

const toggleItemSchema = z.object({ is_done: z.boolean() });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!perms.has("tickets.resolve")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: ticket } = await admin
    .from("lead_tickets")
    .select("id, created_by, lead_id, assigned_to")
    .eq("id", id)
    .single();
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

  // Only the assignee or someone with this ticket in view scope may check items.
  const scope = await allowedTicketScope(admin, user.id, perms);
  if (!canActOnTicket(ticket, user.id, scope)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = toggleItemSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const { is_done } = parsed.data;
  const now = new Date().toISOString();

  const { data: item, error } = await admin
    .from("ticket_items")
    .update({
      is_done,
      done_at: is_done ? now : null,
      done_by: is_done ? user.id : null,
    })
    .eq("id", itemId)
    .eq("ticket_id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ item });
}
