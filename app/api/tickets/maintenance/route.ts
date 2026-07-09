import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAppSettings } from "@/lib/settings/appSettings";
import { bumpPriority } from "@/lib/tickets/logic";
import { notifyTicket, adminUserIds } from "@/lib/tickets/notify";
import type { TicketPriority, TicketStatus } from "@/lib/tickets/types";

export const runtime = "nodejs";

// Headless maintenance sweep — kicked every 5 minutes by the instrumentation
// poller (mirrors /api/notifications/generate's secret-gated pattern; no
// user session exists when this runs). Two jobs per pass:
//   1. Escalate: tickets past their SLA due_date get their priority bumped
//      one step and a one-time "overdue" notification. `escalated_at` is set
//      in the same update as the bump, and the query only selects rows where
//      `escalated_at is null`, so a ticket can never be escalated twice —
//      even though it stays overdue/non-Resolved on every later pass.
//   2. Purge: Resolved tickets past the configured retention window are
//      deleted, along with their Storage attachment files and any
//      notifications that deep-link to them.
export async function POST(req: Request) {
  const expected = process.env.WGE_PROCESSOR_SECRET;
  const secret = req.headers.get("x-wge-secret");
  // Fail closed: if the secret isn't configured, reject everything (never
  // process unauthenticated, which would otherwise pass when expected is undefined).
  if (!expected || !secret || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();

  type OverdueTicket = {
    id: string;
    priority: TicketPriority;
    status: TicketStatus;
    assigned_to: string | null;
    lead_id: string;
  };

  const { data: overdueRaw } = await admin
    .from("lead_tickets")
    .select("id, priority, status, assigned_to, lead_id")
    .neq("status", "Resolved")
    .is("escalated_at", null)
    .lt("due_date", now.toISOString());
  const overdue = (overdueRaw ?? []) as OverdueTicket[];

  let escalated = 0;
  for (const t of overdue) {
    const bumped = bumpPriority(t.priority);
    await admin
      .from("lead_tickets")
      .update({ priority: bumped, escalated_at: now.toISOString(), updated_at: now.toISOString() })
      .eq("id", t.id);

    const { data: leadRow } = await admin
      .from("leads")
      .select("business_name")
      .eq("id", t.lead_id)
      .single();
    const lead = leadRow as { business_name: string } | null;

    try {
      await notifyTicket({
        eventKey: "ticket_overdue",
        ticketId: t.id,
        leadId: t.lead_id,
        recipients: [...(await adminUserIds()), t.assigned_to].filter(
          (v): v is string => Boolean(v)
        ),
        title: "Ticket overdue",
        body: `${lead?.business_name ?? "Lead"} — escalated to ${bumped}`,
        nonce: now.toISOString(),
      });
    } catch {
      // Notification failures must never fail the maintenance sweep.
    }
    escalated++;
  }

  // Purge resolved tickets older than retention (only when retention > 0 —
  // 0 means "keep forever", per the admin settings hint).
  const settings = await getAppSettings();
  let purged = 0;
  if (settings.ticket_retention_days > 0) {
    const cutoff = new Date(
      now.getTime() - settings.ticket_retention_days * 86_400_000
    ).toISOString();
    const { data: oldRaw } = await admin
      .from("lead_tickets")
      .select("id")
      .eq("status", "Resolved")
      .lt("resolved_at", cutoff)
      .limit(200);
    const old = (oldRaw ?? []) as { id: string }[];

    for (const t of old) {
      const { data: itemsRaw } = await admin
        .from("ticket_items")
        .select("id")
        .eq("ticket_id", t.id);
      const itemIds = ((itemsRaw ?? []) as { id: string }[]).map((i) => i.id);

      if (itemIds.length) {
        const { data: attsRaw } = await admin
          .from("ticket_item_attachments")
          .select("path")
          .in("item_id", itemIds);
        const paths = ((attsRaw ?? []) as { path: string }[]).map((a) => a.path);
        if (paths.length) await admin.storage.from("ticket-attachments").remove(paths);
      }

      await admin.from("notifications").delete().eq("target_url", `/tickets/${t.id}`);
      await admin.from("lead_tickets").delete().eq("id", t.id); // cascades items + attachment rows
      purged++;
    }
  }

  return NextResponse.json({ escalated, purged });
}
