import { createClient } from "@/lib/supabase/server";
import { getMailboxForUser } from "@/lib/mail/mailbox";
import type { ResolvedMailbox } from "@/lib/mail/types";

/**
 * Resolve the caller's OWN verified mailbox. Never trusts a mailbox id from
 * the client. 401 = not signed in; 403 = signed in but no verified mailbox.
 */
export async function requireOwnMailbox(): Promise<{ mailbox: ResolvedMailbox } | { error: 401 | 403 }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const mailbox = await getMailboxForUser(user.id);
  if (!mailbox) return { error: 403 };
  return { mailbox };
}
