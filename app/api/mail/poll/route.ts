import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveMailboxRow } from "@/lib/mail/config";
import { fetchInboxSince } from "@/lib/mail/imap";
import { planMailPoll, mailDedupKey, mailNotificationText } from "@/lib/mail/poll";
import { notify } from "@/lib/notifications/notify";
import type { CompanyMailboxRow } from "@/lib/mail/types";

export const runtime = "nodejs";

/**
 * Cron entry point: poll every verified company mailbox for new INBOX mail and
 * raise a `mail_received` notification per new message.
 *
 * Guarded by a shared secret header (`x-mail-poll-secret`). Fails closed: if
 * MAIL_POLL_SECRET is unset the endpoint rejects everything rather than
 * becoming an open IMAP-fanout trigger.
 *
 * Never logs credentials — only mailbox ids and counts.
 */
async function poll(req: Request) {
  const expected = process.env.MAIL_POLL_SECRET;
  const provided = req.headers.get("x-mail-poll-secret");
  if (!expected || !provided || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("company_mailboxes")
    .select("*")
    .eq("status", "verified")
    .order("created_at", { ascending: true });

  let checked = 0;
  let notified = 0;

  for (const row of (rows ?? []) as (CompanyMailboxRow & { last_notified_uid: number | null })[]) {
    // One mailbox must never abort the run — an expired password or a dead
    // host is that mailbox's problem, not the cron's.
    try {
      const mailbox = resolveMailboxRow(row);
      const lastUid =
        row.last_notified_uid === null || row.last_notified_uid === undefined
          ? null
          : Number(row.last_notified_uid);

      const { uidNext, messages } = await fetchInboxSince(mailbox, lastUid);
      const plan = planMailPoll(lastUid, uidNext, messages);
      checked += 1;

      for (const msg of plan.toNotify) {
        const { title, body } = mailNotificationText(msg, mailbox.address);
        try {
          // No actorId: an inbound email has no actor in this system, and
          // expandTargets() would otherwise drop the owner from the recipients.
          await notify(
            "mail_received",
            { mailbox: { user_id: row.user_id } },
            { title, body, dedupKey: mailDedupKey(row.id, msg.uid), targetUrl: "/mailbox" }
          );
          notified += 1;
        } catch {
          /* a failed bell must not stop the rest of the batch */
        }
      }

      if (plan.highestUid !== null && plan.highestUid !== lastUid) {
        await admin.from("company_mailboxes").update({ last_notified_uid: plan.highestUid }).eq("id", row.id);
      }
    } catch {
      /* unreachable mailbox — skip it, keep polling the others */
    }
  }

  return NextResponse.json({ checked, notified });
}

export async function GET(req: Request) {
  return poll(req);
}

export async function POST(req: Request) {
  return poll(req);
}
