import { createAdminClient } from "@/lib/supabase/admin";
import { eventDefault } from "@/lib/notifications/events";
import { getRule } from "@/lib/notifications/rules";
import { resolveRecipients } from "@/lib/notifications/resolve";
import type { NotifyContext } from "@/lib/notifications/types";

export async function notify(eventKey: string, ctx: NotifyContext,
  opts: { title: string; body: string; dedupKey: string; targetUrl?: string | null; websiteUrl?: string | null }): Promise<void> {
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
    website_url: opts.websiteUrl ?? null,
  }));
  const { error } = await admin.from("notifications").upsert(rows, { onConflict: "dedup_key", ignoreDuplicates: true });
  if (error && /website_url/i.test(error.message)) {
    // Migration 0066 not applied yet — deliver without the website_url column
    // rather than dropping the notification entirely.
    const legacy = rows.map(({ website_url: _drop, ...rest }) => rest);
    await admin.from("notifications").upsert(legacy, { onConflict: "dedup_key", ignoreDuplicates: true });
  }
}
