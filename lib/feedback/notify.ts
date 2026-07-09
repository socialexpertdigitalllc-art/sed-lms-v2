import { createAdminClient } from "@/lib/supabase/admin";
import { effectiveSetting } from "@/lib/notifications/logic";

async function settingsFor(admin: ReturnType<typeof createAdminClient>, userIds: string[], eventKey: string) {
  const { data } = await admin
    .from("user_notification_settings")
    .select("user_id, event_key, enabled, lead_time_minutes")
    .in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"])
    .eq("event_key", eventKey);
  const byUser = new Map((data ?? []).map((r) => [r.user_id, r]));
  return (uid: string) => effectiveSetting(eventKey, byUser.get(uid) ?? null);
}

export async function notifyFeedback(opts: {
  eventKey: "feedback_submitted" | "feedback_resolved";
  feedbackId: string;
  recipients: string[];
  title: string;
  body: string;
  nonce: string;
}) {
  const admin = createAdminClient();
  const recipients = [...new Set(opts.recipients.filter(Boolean))];
  if (!recipients.length) return;
  const get = await settingsFor(admin, recipients, opts.eventKey);
  const rows = recipients
    .filter((uid) => get(uid).enabled)
    .map((uid) => ({
      user_id: uid,
      event_key: opts.eventKey,
      lead_id: null,
      title: opts.title,
      body: opts.body,
      dedup_key: `${opts.eventKey}:${opts.feedbackId}:${uid}:${opts.nonce}`,
      target_url: "/feedback",
    }));
  if (rows.length) await admin.from("notifications").upsert(rows, { onConflict: "dedup_key", ignoreDuplicates: true });
}

/** Members of departments holding feedback.manage (tech + admin). */
export async function feedbackManagerIds(): Promise<string[]> {
  const admin = createAdminClient();
  const { data: depts } = await admin.from("departments").select("id").in("slug", ["tech", "admin"]);
  const deptIds = (depts ?? []).map((d) => d.id);
  if (!deptIds.length) return [];
  const { data } = await admin
    .from("department_members")
    .select("user_id, profiles!department_members_user_id_fkey(id)")
    .in("department_id", deptIds);
  return [...new Set((data ?? []).map((m: any) => m.user_id).filter(Boolean))];
}
