import { NextResponse } from "next/server";
import { requireOwnMailbox } from "@/lib/mail/guard";
import { getUnreadCount } from "@/lib/mail/imap";

export const runtime = "nodejs";

/**
 * Unread INBOX count for the caller's own mailbox — drives the sidebar badge.
 * Fail-soft by design: an unreachable IMAP server returns `{ unread: 0 }` with
 * a 200 so a mail outage never breaks navigation.
 */
export async function GET() {
  const auth = await requireOwnMailbox();
  if ("error" in auth) {
    if (auth.error === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ unread: 0 });
  }

  try {
    return NextResponse.json({ unread: await getUnreadCount(auth.mailbox) });
  } catch {
    return NextResponse.json({ unread: 0 });
  }
}
