import { createAdminClient } from "@/lib/supabase/admin";
import { effectiveSetting } from "@/lib/notifications/logic";
import { dedupKey } from "@/lib/tickets/logic";

type Recipient = string;

async function settingsFor(admin: ReturnType<typeof createAdminClient>, userIds: string[], eventKey: string) {
  const { data } = await admin.from("user_notification_settings").select("user_id, event_key, enabled, lead_time_minutes").in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]).eq("event_key", eventKey);
  const byUser = new Map((data ?? []).map((r) => [r.user_id, r]));
  return (uid: string) => effectiveSetting(eventKey, byUser.get(uid) ?? null);
}

export async function notifyTicket(opts: {
  eventKey: "ticket_opened" | "ticket_assigned" | "ticket_resolved" | "ticket_reopened" | "ticket_overdue";
  ticketId: string; leadId: string; recipients: Recipient[]; title: string; body: string; nonce: string;
}) {
  const admin = createAdminClient();
  const recipients = [...new Set(opts.recipients.filter(Boolean))];
  if (!recipients.length) return;
  const get = await settingsFor(admin, recipients, opts.eventKey);
  const rows = recipients
    .filter((uid) => get(uid).enabled)
    .map((uid) => ({
      user_id: uid, event_key: opts.eventKey, lead_id: opts.leadId,
      title: opts.title, body: opts.body,
      dedup_key: dedupKey(opts.eventKey, opts.ticketId, uid, opts.nonce),
      target_url: `/tickets/${opts.ticketId}`,
    }));
  if (rows.length) await admin.from("notifications").upsert(rows, { onConflict: "dedup_key", ignoreDuplicates: true });
}

/** Admin-department member ids (recipients for ticket_opened). */
export async function adminUserIds(): Promise<string[]> {
  const admin = createAdminClient();
  const { data: dept } = await admin.from("departments").select("id").eq("slug", "admin").single();
  if (!dept) return [];
  const { data } = await admin.from("department_members").select("user_id, profiles!department_members_user_id_fkey(id)").eq("department_id", dept.id);
  return (data ?? []).map((m: any) => m.user_id).filter(Boolean);
}

/** Tech-department members for the assignment picker. */
export async function techMembers(): Promise<{ id: string; display_name: string }[]> {
  const admin = createAdminClient();
  const { data: dept } = await admin.from("departments").select("id").eq("slug", "tech").single();
  if (!dept) return [];
  const { data } = await admin.from("department_members").select("user_id, profiles!department_members_user_id_fkey(id, display_name)").eq("department_id", dept.id);
  return (data ?? []).map((m: any) => ({ id: m.profiles?.id, display_name: m.profiles?.display_name })).filter((u: any) => u.id);
}
