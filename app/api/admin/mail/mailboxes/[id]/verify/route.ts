import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getMailboxById, verifyMailboxCredentials } from "@/lib/mail/mailbox";

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
  const { data: safe } = await admin.from("company_mailboxes").select(SAFE_COLS).eq("id", id).single();
  return NextResponse.json({ mailbox: safe });
}
