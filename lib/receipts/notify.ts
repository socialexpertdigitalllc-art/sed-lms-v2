import { notify } from "@/lib/notifications/notify";

/**
 * A lead just became Closed: ping billing (rule `receipt_needed`, default
 * target the Accounts department) so a receipt goes out even when the closer
 * can't send one. The link opens the receipt form straight away.
 * Best-effort, like every bell — it never fails the status change.
 */
export async function notifyReceiptNeeded(args: {
  leadId: string;
  businessName: string;
  lead: { agent_id: string | null; closed_by: string | null };
  actorId: string;
}): Promise<void> {
  try {
    await notify(
      "receipt_needed",
      { leadId: args.leadId, lead: args.lead, actorId: args.actorId },
      {
        title: "Payment receipt needed",
        body: `${args.businessName} was marked Closed. Send the client their receipt.`,
        dedupKey: `receipt_needed:${args.leadId}:${new Date().toISOString()}`,
        targetUrl: `/leads/${args.leadId}?receipt=new`,
      }
    );
  } catch {
    /* bell is best-effort */
  }
}
