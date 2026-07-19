import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getMailboxById, verifyMailboxCredentials } from "@/lib/mail/mailbox";
import { notify } from "@/lib/notifications/notify";

export const runtime = "nodejs";

const SAFE_COLS =
  "id, user_id, email_address, display_name, imap_host, imap_port, smtp_host, smtp_port, status, last_verified_at, last_error, created_at";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("mail.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const mailbox = await getMailboxById(id);
  if (!mailbox) return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });

  const result = await verifyMailboxCredentials(mailbox);
  const patch = result.ok
    ? { status: "verified" as const, last_verified_at: new Date().toISOString(), last_error: null }
    : { status: "error" as const, last_error: result.error };

  const admin = createAdminClient();
  await admin.from("company_mailboxes").update(patch).eq("id", id);

  if (!result.ok) {
    // Owner-facing: their mailbox stopped working (expired password, host change).
    try {
      await notify(
        "mailbox_verification_failed",
        { mailbox: { user_id: mailbox.userId } },
        {
          title: "Company mailbox verification failed",
          body: `${mailbox.address} — ${result.error}`,
          dedupKey: `mailbox_verification_failed:${id}:${new Date().toISOString()}`,
          targetUrl: "/admin/mail",
        }
      );
    } catch { /* bell is best-effort */ }
  }

  const { data: safe } = await admin.from("company_mailboxes").select(SAFE_COLS).eq("id", id).single();
  return NextResponse.json({ mailbox: safe });
}
