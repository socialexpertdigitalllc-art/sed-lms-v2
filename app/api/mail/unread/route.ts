import { NextResponse } from "next/server";
import { requireOwnMailbox } from "@/lib/mail/guard";
import { getUnreadCount } from "@/lib/mail/imap";
import { ttlCached } from "@/lib/cache/ttl";

/**
 * Every open tab polls this every 60s and each poll was a full IMAP
 * connect → login → STATUS → logout. One answer per mailbox per window is
 * shared by all of that person's tabs; the badge is allowed to lag this long.
 */
const UNREAD_TTL_MS = 45_000;

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
    const unread = await ttlCached("mail-unread", auth.mailbox.id, UNREAD_TTL_MS, () => getUnreadCount(auth.mailbox));
    return NextResponse.json({ unread });
  } catch {
    return NextResponse.json({ unread: 0 });
  }
}
