import type { SupabaseClient } from "@supabase/supabase-js";
import { finalizeSiteReview, loadSiteReview } from "@/lib/leads/siteReview";
import { recordStatusChange } from "@/lib/leads/statusEvents";
import { isReadyGuardError, READY_GUARD_MESSAGE } from "@/lib/leads/errors";

/**
 * The SENT button beside a lead's deadline timer (lib/leads/deadline.ts): the
 * website went to the client, so the lead turns Ready — for Tech and Admin.
 *
 * A lead can only be Ready with a website link (DB guard, migration 0025). A
 * site still waiting for the developer (lib/leads/siteReview.ts) is finalized
 * first, in the same click; with no website at all, nothing changes.
 * The same side effects as a status change on the lead page: the status
 * history, the activity log, "Lead status changed" and "Website ready".
 */

type Lead = {
  id: string;
  status: string;
  business_name: string | null;
  agent_id: string | null;
  closed_by: string | null;
  website_link: string | null;
};

export type SentResult =
  | { ok: true; already?: boolean; finalized?: boolean; websiteLink: string }
  | { ok: false; status: number; error: string };

async function readLead(admin: SupabaseClient, leadId: string): Promise<Lead | null> {
  const { data } = await admin
    .from("leads")
    .select("id, status, business_name, agent_id, closed_by, website_link")
    .eq("id", leadId)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as Lead | null) ?? null;
}

export async function markWebsiteSent(admin: SupabaseClient, args: { leadId: string; actorId: string }): Promise<SentResult> {
  let lead = await readLead(admin, args.leadId);
  if (!lead) return { ok: false, status: 404, error: "Lead not found" };
  if (lead.status === "Ready") return { ok: true, already: true, websiteLink: lead.website_link ?? "" };
  if (lead.status !== "Not Ready") {
    return { ok: false, status: 409, error: `This lead is ${lead.status}, so it can't be marked sent from here.` };
  }

  // A site waiting for the developer: finalize it in the same click.
  let finalized = false;
  if (await loadSiteReview(admin, lead.id)) {
    const r = await finalizeSiteReview(admin, { leadId: lead.id, actorId: args.actorId });
    if ("error" in r) return { ok: false, status: r.status, error: r.error };
    finalized = true;
    lead = (await readLead(admin, args.leadId)) ?? lead;
  }
  const link = (lead.website_link ?? "").trim();
  if (!link) return { ok: false, status: 409, error: "No website yet — publish the site first, then press SENT." };

  const { error } = await admin.from("leads").update({ status: "Ready" }).eq("id", lead.id).eq("status", "Not Ready");
  if (error) {
    return { ok: false, status: isReadyGuardError(error) ? 422 : 500, error: isReadyGuardError(error) ? READY_GUARD_MESSAGE : error.message };
  }

  await admin.from("activity_log").insert({
    user_id: args.actorId,
    action: "lead.status_changed",
    entity_type: "lead",
    entity_id: lead.id,
    old_value: { status: lead.status },
    new_value: { status: "Ready", via: "sent_button" },
  });
  await recordStatusChange(admin, { leadId: lead.id, from: lead.status, to: "Ready", userId: args.actorId });

  const nonce = new Date().toISOString();
  const who = { leadId: lead.id, lead: { agent_id: lead.agent_id, closed_by: lead.closed_by }, actorId: args.actorId };
  try {
    const { notify } = await import("@/lib/notifications/notify");
    await notify("lead_status_changed", who, {
      title: "Lead status changed",
      body: `${lead.business_name ?? "A lead"} → Ready`,
      dedupKey: `lead_status_changed:${lead.id}:Ready:${nonce}`,
      targetUrl: `/leads/${lead.id}`,
    });
    await notify("website_ready", who, {
      title: "Website ready",
      body: `${lead.business_name ?? "This lead"}'s website is ready`,
      dedupKey: `website_ready:${lead.id}:${nonce}`,
      targetUrl: `/leads/${lead.id}`,
      websiteUrl: link,
    });
  } catch {
    /* a notification is never worth failing the click over */
  }
  try {
    // Does the business's exact name exist as a .com? (the lead's Domain card)
    const { kickLeadDomainChecks } = await import("@/lib/domains/leadCheck");
    kickLeadDomainChecks([lead.id]);
  } catch {
    /* best effort */
  }
  return { ok: true, finalized, websiteLink: link };
}
