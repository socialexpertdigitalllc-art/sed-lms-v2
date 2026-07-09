import { createAdminClient } from "@/lib/supabase/admin";
import { eventDefault } from "@/lib/notifications/events";
import { getRule } from "@/lib/notifications/rules";
import { resolveRecipients } from "@/lib/notifications/resolve";
import type { NotifyContext } from "@/lib/notifications/types";

export async function notify(eventKey: string, ctx: NotifyContext,
  opts: { title: string; body: string; dedupKey: string; targetUrl?: string | null }): Promise<void> {
  const rule = await getRule(eventKey);
  if (!rule) return;
  const recipients = await resolveRecipients(rule, ctx);
  if (!recipients.length) return;
  const bell = eventDefault(eventKey)?.bell ?? "general";
  const deliverAfter = new Date(Date.now() + (rule.delay_minutes ?? 0) * 60_000).toISOString();
  const admin = createAdminClient();
  const rows = recipients.map((uid) => ({
    user_id: uid, event_key: eventKey, lead_id: ctx.leadId ?? null,
    title: opts.title, body: opts.body, dedup_key: `${opts.dedupKey}:${uid}`,
    target_url: opts.targetUrl ?? null, bell, deliver_after: deliverAfter,
  }));
  await admin.from("notifications").upsert(rows, { onConflict: "dedup_key", ignoreDuplicates: true });
}
