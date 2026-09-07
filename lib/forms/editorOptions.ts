import type { FormsAuth } from "@/lib/forms/guard";
import type { LeadOption, MailboxOption } from "@/components/form-relay/EndpointEditor";

/** Leads the caller may attach (their own, or all with leads.view_all) + verified mailboxes. */
export async function loadEditorOptions(auth: FormsAuth): Promise<{ leads: LeadOption[]; mailboxes: MailboxOption[] }> {
  let q = auth.admin.from("leads").select("id, business_name, business_email").is("deleted_at", null).order("business_name");
  if (!auth.scope.all) q = q.eq("agent_id", auth.userId);
  const { data: leads } = await q;
  const { data: mailboxes } = await auth.admin.from("company_mailboxes").select("id, email_address, display_name").eq("status", "verified").order("email_address");
  return { leads: (leads ?? []) as LeadOption[], mailboxes: (mailboxes ?? []) as MailboxOption[] };
}
