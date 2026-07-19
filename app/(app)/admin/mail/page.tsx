import { redirect } from "next/navigation";
import { MailPlus } from "lucide-react";
import { PageHeader } from "@/components/common/Panel";
import { btnSecondary } from "@/components/common/buttons";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { CompanyMailManager, type MailboxListItem } from "@/components/mail/CompanyMailManager";

export default async function CompanyMailPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const perms = await getUserPermissions(user.id);
  if (!perms.has("mail.manage")) redirect("/dashboard");

  const admin = createAdminClient();
  // No encrypted_password in this select — the secret never reaches the client.
  const { data: mailboxes } = await admin
    .from("company_mailboxes")
    .select("id, user_id, email_address, display_name, imap_host, imap_port, smtp_host, smtp_port, status, last_verified_at, last_error, created_at")
    .order("created_at", { ascending: false });

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, display_name")
    .eq("is_active", true)
    .order("display_name");

  const owners = (profiles ?? []).map((p) => ({ id: p.id, name: p.display_name ?? "—" }));
  const ownerName: Record<string, string> = {};
  for (const o of owners) ownerName[o.id] = o.name;

  const items: MailboxListItem[] = (mailboxes ?? []).map((m) => ({ ...m, owner_name: ownerName[m.user_id] ?? "—" }));

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="Company Mail"
        description="Link a manually-created Hostinger mailbox to a user. The password is stored encrypted and used only to send/read mail server-side."
        action={
          <a href="#link-mailbox" className={btnSecondary}>
            <MailPlus className="h-4 w-4" /> Link a mailbox
          </a>
        }
      />
      <CompanyMailManager initial={items} owners={owners} />
    </div>
  );
}
