// lib/push/dispatch.ts
/**
 * Delivers the notification bell to people's desktops and phones. SERVER ONLY.
 *
 * Every row in `notifications` is pushed once it is due (deliver_after has
 * passed) to each of its owner's push subscriptions, whichever code path
 * inserted it (notify(), the reminder generator, the assistant…). The row is
 * CLAIMED first (pushed_at stamped only while still null), so the poller and
 * an immediate kick from notify() can race without anyone getting a message
 * twice.
 *
 * Not pushed, only claimed: rows already read in the app, and rows that came
 * due long ago (a server that was down for a day must not fire yesterday's
 * reminders). A burst for one person (a bulk import's "new lead" rows)
 * collapses into one summary push; urgent events always arrive one by one.
 */
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushPayloadFor, type PushPayload } from "./payload";
import { getVapid, type VapidKeys } from "./vapid";

/** Due longer ago than this = stale: claimed, never sent. */
export const PUSH_FRESH_MS = 2 * 60 * 60_000;
/** More non-urgent pushes than this for one person in one pass → one summary. */
export const PUSH_BURST = 3;
/** How long a push service keeps a message for an offline device. */
const PUSH_TTL_S = 6 * 60 * 60;
const BATCH = 200;
const PARALLEL = 10;

export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failure_count?: number | null;
}

interface DueRow {
  id: string;
  user_id: string;
  event_key: string;
  title: string;
  body: string;
  created_at: string;
  deliver_after: string;
  read_at: string | null;
  lead_id: string | null;
  target_url: string | null;
}

/** The send seam — web-push in production, a fake in tests. Resolves on
 *  success; rejects with `{ statusCode }` on a push-service refusal. */
export type PushSender = (sub: PushSubscriptionRow, payload: PushPayload, vapid: VapidKeys) => Promise<void>;

export const webPushSender: PushSender = async (sub, payload, vapid) => {
  await webpush.sendNotification(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    JSON.stringify(payload),
    {
      vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
      TTL: PUSH_TTL_S,
      urgency: payload.urgent ? "high" : "normal",
    },
  );
};

/** What one person is sent this pass: urgent ones singly, the rest singly up
 *  to PUSH_BURST, else one summary pointing at the inbox. */
export function planPushes(rows: DueRow[]): PushPayload[] {
  const payloads = rows.map((r) => pushPayloadFor(r));
  const urgent = payloads.filter((p) => p.urgent);
  const normal = payloads.filter((p) => !p.urgent);
  if (normal.length <= PUSH_BURST) return [...urgent, ...normal];
  const titles = normal.slice(0, 3).map((p) => p.title);
  const more = normal.length - titles.length;
  return [
    ...urgent,
    {
      id: null,
      title: `${normal.length} new notifications`,
      body: titles.join(" · ") + (more > 0 ? ` · +${more} more` : ""),
      url: "/notifications",
      tag: "summary",
      urgent: false,
      ts: Math.max(...normal.map((p) => p.ts)),
    },
  ];
}

const statusOf = (e: unknown): number | null => {
  const s = (e as { statusCode?: unknown } | null)?.statusCode;
  return typeof s === "number" ? s : null;
};

/** Send each payload to each subscription; prune subscriptions the push
 *  service says are gone (404/410), record successes and failures. */
export async function deliver(
  admin: SupabaseClient,
  jobs: { sub: PushSubscriptionRow; payload: PushPayload }[],
  vapid: VapidKeys,
  send: PushSender,
  now: Date,
): Promise<{ sent: number; failed: number; removed: number }> {
  let sent = 0;
  let failed = 0;
  const gone = new Set<string>();
  const ok = new Set<string>();
  const bad = new Map<string, PushSubscriptionRow>();
  for (let i = 0; i < jobs.length; i += PARALLEL) {
    await Promise.all(
      jobs.slice(i, i + PARALLEL).map(async ({ sub, payload }) => {
        if (gone.has(sub.id)) return;
        try {
          await send(sub, payload, vapid);
          sent++;
          ok.add(sub.id);
        } catch (e) {
          failed++;
          const status = statusOf(e);
          if (status === 404 || status === 410) gone.add(sub.id);
          else bad.set(sub.id, sub);
        }
      }),
    );
  }
  const iso = now.toISOString();
  if (gone.size) await admin.from("push_subscriptions").delete().in("id", [...gone]);
  const succeeded = [...ok].filter((id) => !gone.has(id));
  if (succeeded.length) {
    await admin.from("push_subscriptions").update({ last_success_at: iso, failure_count: 0 }).in("id", succeeded);
  }
  for (const [id, sub] of bad) {
    if (gone.has(id) || ok.has(id)) continue;
    await admin
      .from("push_subscriptions")
      .update({ last_failure_at: iso, failure_count: (sub.failure_count ?? 0) + 1 })
      .eq("id", id);
  }
  return { sent, failed, removed: gone.size };
}

export interface DispatchResult {
  claimed: number;
  sent: number;
  failed: number;
  removed: number;
}

const NOTHING: DispatchResult = { claimed: 0, sent: 0, failed: 0, removed: 0 };

/** One pass: claim what is due, push the fresh unread ones. Never throws. */
export async function dispatchDuePush(
  admin: SupabaseClient = createAdminClient(),
  now: Date = new Date(),
  send: PushSender = webPushSender,
): Promise<DispatchResult> {
  try {
    const nowIso = now.toISOString();
    const { data: due, error } = await admin
      .from("notifications")
      .select("id, user_id, event_key, title, body, created_at, deliver_after, read_at, lead_id, target_url")
      .is("pushed_at", null)
      .lte("deliver_after", nowIso)
      .order("deliver_after", { ascending: true })
      .limit(BATCH);
    if (error || !due?.length) return NOTHING; // nothing due — or migration 0088 not applied

    // Keys BEFORE claiming: an instance that can't sign pushes (the office
    // worker box has no MAILBOX_ENC_KEY) must leave the rows for one that can.
    const vapid = await getVapid(admin);
    if (!vapid) return NOTHING;

    const { data: claimedRows } = await admin
      .from("notifications")
      .update({ pushed_at: nowIso })
      .in("id", (due as DueRow[]).map((r) => r.id))
      .is("pushed_at", null)
      .select("id");
    const claimed = new Set(((claimedRows ?? []) as { id: string }[]).map((r) => r.id));
    if (!claimed.size) return NOTHING;

    const fresh = (due as DueRow[]).filter(
      (r) => claimed.has(r.id) && !r.read_at && now.getTime() - new Date(r.deliver_after).getTime() <= PUSH_FRESH_MS,
    );
    if (!fresh.length) return { ...NOTHING, claimed: claimed.size };

    const users = [...new Set(fresh.map((r) => r.user_id))];
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth, failure_count")
      .in("user_id", users);
    const subsByUser = new Map<string, PushSubscriptionRow[]>();
    for (const s of (subs ?? []) as PushSubscriptionRow[]) subsByUser.set(s.user_id, [...(subsByUser.get(s.user_id) ?? []), s]);
    if (!subsByUser.size) return { ...NOTHING, claimed: claimed.size };

    const jobs: { sub: PushSubscriptionRow; payload: PushPayload }[] = [];
    for (const user of users) {
      const mine = subsByUser.get(user);
      if (!mine?.length) continue;
      for (const payload of planPushes(fresh.filter((r) => r.user_id === user))) {
        for (const sub of mine) jobs.push({ sub, payload });
      }
    }
    const out = await deliver(admin, jobs, vapid, send, now);
    return { claimed: claimed.size, ...out };
  } catch (e) {
    console.error("[push] dispatch failed:", e instanceof Error ? e.message : e);
    return NOTHING;
  }
}

/** "Send a test" from the settings card: every device this person has on. */
export async function sendTestPush(
  admin: SupabaseClient,
  userId: string,
  send: PushSender = webPushSender,
  now: Date = new Date(),
): Promise<{ devices: number; sent: number; failed: number; removed: number; ready: boolean }> {
  const vapid = await getVapid(admin);
  if (!vapid) return { devices: 0, sent: 0, failed: 0, removed: 0, ready: false };
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth, failure_count")
    .eq("user_id", userId);
  const list = (subs ?? []) as PushSubscriptionRow[];
  const payload: PushPayload = {
    id: null,
    title: "Notifications are on",
    body: "This is how SED LMS will reach you when the LMS isn't open.",
    url: "/notifications",
    tag: "test",
    urgent: false,
    ts: now.getTime(),
  };
  const out = await deliver(admin, list.map((sub) => ({ sub, payload })), vapid, send, now);
  return { devices: list.length, ...out, ready: true };
}
