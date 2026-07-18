import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { linkMailboxSchema } from "@/lib/mail/schema";
import { encryptSecret } from "@/lib/mail/crypto";
import { resolveMailboxRow } from "@/lib/mail/config";
import { verifyMailboxCredentials } from "@/lib/mail/mailbox";
import { MAILBOX_DEFAULTS, type CompanyMailboxRow } from "@/lib/mail/types";

export const runtime = "nodejs";

// Columns safe to return to the client — NEVER encrypted_password.
const SAFE_COLS =
  "id, user_id, email_address, display_name, imap_host, imap_port, smtp_host, smtp_port, status, last_verified_at, last_error, created_at";

async function guard(): Promise<{ userId: string } | { error: 401 | 403 }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  if (!perms.has("mail.manage")) return { error: 403 };
  return { userId: user.id };
}

function guardError(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
}

export async function GET() {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const admin = createAdminClient();
  const { data, error } = await admin.from("company_mailboxes").select(SAFE_COLS).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ mailboxes: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const parsed = linkMailboxSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }
  const input = parsed.data;
  const admin = createAdminClient();

  // Insert unverified first (encrypted). Never store or log the plaintext.
  const insertRow = {
    user_id: input.user_id,
    email_address: input.email_address,
    display_name: input.display_name,
    imap_host: input.imap_host ?? MAILBOX_DEFAULTS.imap_host,
    imap_port: input.imap_port ?? MAILBOX_DEFAULTS.imap_port,
    smtp_host: input.smtp_host ?? MAILBOX_DEFAULTS.smtp_host,
    smtp_port: input.smtp_port ?? MAILBOX_DEFAULTS.smtp_port,
    encrypted_password: encryptSecret(input.password),
    status: "unverified" as const,
    created_by: auth.userId,
  };
  const { data: inserted, error: insErr } = await admin
    .from("company_mailboxes")
    .insert(insertRow)
    .select("*")
    .single();
  if (insErr || !inserted) {
    const dup = insErr?.code === "23505";
    return NextResponse.json(
      { error: dup ? "That email address is already linked" : insErr?.message ?? "Insert failed" },
      { status: dup ? 409 : 400 }
    );
  }

  // Real IMAP + SMTP login.
  const result = await verifyMailboxCredentials(resolveMailboxRow(inserted as CompanyMailboxRow));
  const patch = result.ok
    ? { status: "verified" as const, last_verified_at: new Date().toISOString(), last_error: null }
    : { status: "error" as const, last_error: result.error };
  await admin.from("company_mailboxes").update(patch).eq("id", inserted.id);

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "mailbox.linked",
    entity_type: "company_mailbox",
    entity_id: inserted.id,
    new_value: { email_address: input.email_address, status: patch.status },
  });

  const { data: safe } = await admin.from("company_mailboxes").select(SAFE_COLS).eq("id", inserted.id).single();
  return NextResponse.json({ mailbox: safe }, { status: 201 });
}
