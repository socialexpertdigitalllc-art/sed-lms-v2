import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMailboxForUser } from "@/lib/mail/mailbox";
import { Mailbox } from "@/components/mail/Mailbox";

export default async function MailboxPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const mailbox = await getMailboxForUser(user.id);
  if (!mailbox) redirect("/dashboard");

  return (
    <div className="max-w-6xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-text">Mailbox</h1>
        <p className="text-sm text-text-muted mt-0.5">{mailbox.address}</p>
      </div>
      <Mailbox address={mailbox.address} />
    </div>
  );
}
