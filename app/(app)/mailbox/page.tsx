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
    <div className="flex h-[calc(100vh-2rem)] flex-col gap-3 sm:h-[calc(100vh-3rem)]">
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h1 className="font-display text-xl font-semibold text-text">Mailbox</h1>
        <p className="font-mono tabular text-xs text-text-muted">{mailbox.address}</p>
      </div>
      <div className="min-h-0 flex-1">
        <Mailbox address={mailbox.address} />
      </div>
    </div>
  );
}
