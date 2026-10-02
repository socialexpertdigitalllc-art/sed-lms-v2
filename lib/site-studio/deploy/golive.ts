import type { SupabaseClient } from "@supabase/supabase-js";
import { notify } from "@/lib/notifications/notify";
import { subFromWebsiteLink, deleteSubdomain, subdomainExists } from "@/lib/template-engine/directadmin";
import { siteHostFrom } from "./liveFiles";
import { adoptSubdomain } from "./manage";
import { probeSite, pushStagingToDomain } from "./transfer";

export type GoLiveResult =
  | {
      ok: true;
      url: string;
      provisioning: boolean;
      subdomainDeleted: boolean;
      settled: boolean;
      hostingCreated: boolean;
      snapshot: string | null;
      snapshotError: string | null;
      ssl: string | null;
    }
  | { ok: false; status: number; error: string; pending?: boolean; step?: string };

/**
 * Put a live staging deployment on a custom domain — the whole transfer: the
 * hosting work (pushStagingToDomain), then the deployment row, the lead's
 * website_link and any builder run that recorded the staging URL are
 * repointed, the staging subdomain is deleted ONLY once Hostinger confirmed
 * the files are in place, the move is logged, and the lead's people are
 * notified. Shared by the board's Transfer button and the domain pipeline.
 * Failures are logged to activity_log (studio.deployment.transfer_failed).
 */
export async function goLiveOnDomain(input: {
  admin: SupabaseClient;
  deploymentId: string;
  domain: string;
  actorId: string | null;
  /** The lead the site belongs to, when the deployment row doesn't say (a
   *  staging site tracked late, whose row couldn't take the lead). */
  leadId?: string | null;
}): Promise<GoLiveResult> {
  const { admin, deploymentId: id, domain, actorId } = input;
  const daDomain = process.env.DA_DOMAIN ?? "";

  const logFailure = async (step: string, error: string) => {
    console.error(`[transfer] ${id} -> ${domain} failed at ${step}: ${error}`);
    await Promise.resolve(
      admin.from("activity_log").insert({
        user_id: actorId,
        action: "studio.deployment.transfer_failed",
        entity_type: "studio_deployment",
        entity_id: id,
        new_value: { domain, step, error },
      }),
    ).catch(() => {});
  };

  const { data: row } = await admin
    .from("studio_deployments")
    .select("id, lead_id, subdomain, url, status, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { ok: false, status: 404, error: "Deployment not found" };
  if (row.status !== "live") return { ok: false, status: 409, error: "Only a live site can be transferred" };

  const sub = subFromWebsiteLink(row.url as string, daDomain);
  if (!sub) {
    return { ok: false, status: 409, error: "This site is not on a staging subdomain — it looks already transferred." };
  }

  const leadId = (row.lead_id as string | null) ?? input.leadId ?? null;
  const { data: lead } = leadId
    ? await admin
        .from("leads")
        .select("id, business_name, agent_id, closed_by, website_link")
        .eq("id", leadId)
        .maybeSingle()
    : { data: null };

  const now = new Date().toISOString();
  const pushed = await pushStagingToDomain({ admin, sub, domain, nowIso: now });
  if (!pushed.ok) {
    // a setup still running is a "come back shortly", not a failure
    if (!pushed.pending) await logFailure(pushed.step, pushed.error);
    return { ok: false, status: pushed.status, error: pushed.error, pending: pushed.pending, step: pushed.step };
  }

  const url = `https://${domain}`;
  const reachable = await probeSite(domain);

  const priorUrl = row.url as string;
  await admin
    .from("studio_deployments")
    .update({ url, docroot: pushed.website.root_directory, updated_at: now })
    .eq("id", id)
    .eq("status", "live");
  const priorLink = lead?.website_link ?? null;
  if (leadId) await admin.from("leads").update({ website_link: url }).eq("id", leadId);
  await admin.from("builder_runs").update({ deployed_url: url, updated_at: now }).eq("deployed_url", priorUrl);

  // The staging copy is the fallback until Hostinger confirms the files are in
  // place; a delete hiccup only leaves a stale staging URL.
  let subdomainDeleted = false;
  if (pushed.settled) {
    const removed = await deleteSubdomain(sub);
    subdomainDeleted = !removed.error;
  }

  await admin.from("activity_log").insert({
    user_id: actorId,
    action: "studio.deployment.transferred",
    entity_type: "studio_deployment",
    entity_id: id,
    new_value: {
      from: priorUrl,
      to: url,
      subdomain_deleted: subdomainDeleted,
      lead_id: leadId,
      hosting_created: pushed.created,
      settled: pushed.settled,
      snapshot: pushed.snapshot,
      ssl: pushed.ssl,
    },
  });

  if (lead && url !== priorLink) await notifyWebsiteOnDomain(lead, domain, actorId, now);

  return {
    ok: true,
    url,
    provisioning: !reachable,
    subdomainDeleted,
    settled: pushed.settled,
    hostingCreated: pushed.created,
    snapshot: pushed.snapshot,
    snapshotError: pushed.snapshotError,
    ssl: pushed.ssl,
  };
}

/** The lead's live STAGING deployment (the site waiting to go live), if any. */
export async function findLiveStagingDeployment(
  admin: SupabaseClient,
  leadId: string,
): Promise<{ id: string; url: string } | null> {
  const daDomain = process.env.DA_DOMAIN ?? "";
  const { data } = await admin
    .from("studio_deployments")
    .select("id, url, status, deployed_at")
    .eq("lead_id", leadId)
    .eq("status", "live")
    .order("deployed_at", { ascending: false });
  const row = ((data ?? []) as { id: string; url: string }[]).find((r) => subFromWebsiteLink(r.url, daDomain));
  return row ? { id: row.id, url: row.url } : null;
}

type LeadForNotice = { id: string; business_name: string; agent_id: string | null; closed_by: string | null };

/** Tell the lead's people the website is live on its own domain. Never throws. */
async function notifyWebsiteOnDomain(lead: LeadForNotice, domain: string, actorId: string | null, nowIso: string): Promise<void> {
  const url = `https://${domain}`;
  try {
    // website_custom_domain reaches the lead's agent AND Management (rule
    // seeded by migration 0066); falls back to website_link_added when the
    // new rule row isn't in the DB yet.
    await notify(
      "website_custom_domain",
      { leadId: lead.id, lead: { agent_id: lead.agent_id, closed_by: lead.closed_by }, actorId: actorId ?? undefined },
      {
        title: "Website live on custom domain",
        body: `${lead.business_name}'s website is now live at ${url}`,
        dedupKey: `website_custom_domain:${lead.id}:${domain}`,
        targetUrl: `/leads/${lead.id}`,
        websiteUrl: url,
      },
    );
    const { getRule } = await import("@/lib/notifications/rules");
    if (!(await getRule("website_custom_domain"))) {
      await notify(
        "website_link_added",
        { leadId: lead.id, lead: { agent_id: lead.agent_id, closed_by: lead.closed_by }, actorId: actorId ?? undefined },
        {
          title: "Website on custom domain",
          body: `${lead.business_name}'s website is now live at ${url}`,
          dedupKey: `website_link_added:${lead.id}:${nowIso}`,
          targetUrl: `/leads/${lead.id}`,
          websiteUrl: url,
        },
      );
    }
  } catch {}
}

/** The staging subdomain a website link points at ("ggtile.dmviral.com", with
 *  or without https://), or null when it isn't a staging site. */
export function stagingSubFromLink(link: string | null | undefined): string | null {
  const host = siteHostFrom(link ?? "");
  return host ? subFromWebsiteLink(`https://${host}`, process.env.DA_DOMAIN ?? "") : null;
}

/**
 * The lead's staging site to put live on its domain: its tracked deployment,
 * or — when that site was never tracked (made by hand, by an older generator,
 * or its dmviral link was simply typed onto the lead) — the dmviral link on the
 * lead itself, which then starts being tracked on the board so the shared
 * transfer can run on it. A staging site tracked for ANOTHER lead is never
 * taken. null = the lead has no staging site to move.
 */
export async function findOrTrackStaging(
  admin: SupabaseClient,
  leadId: string,
  actorId: string | null,
): Promise<{ id: string; url: string } | null> {
  const tracked = await findLiveStagingDeployment(admin, leadId);
  if (tracked) return tracked;
  const daDomain = process.env.DA_DOMAIN ?? "";
  const { data: lead } = await admin.from("leads").select("website_link").eq("id", leadId).maybeSingle();
  const sub = stagingSubFromLink((lead as { website_link?: string | null } | null)?.website_link);
  if (!sub) return null;

  const { data: existing } = await admin
    .from("studio_deployments")
    .select("id, lead_id, url, status")
    .eq("subdomain", sub)
    .maybeSingle();
  let row = existing as { id: string; lead_id: string | null; url: string; status: string } | null;
  if (row) {
    if (row.lead_id && row.lead_id !== leadId) return null; // another lead's site
    if (row.status !== "live" || !subFromWebsiteLink(row.url, daDomain)) return null;
  } else {
    if (!(await subdomainExists(sub))) return null;
    const adopted = await adoptSubdomain(admin, sub, actorId);
    if ("error" in adopted) return null;
    row = { id: adopted.row.id, lead_id: adopted.row.lead_id, url: adopted.row.url, status: adopted.row.status };
    await admin.from("activity_log").insert({
      user_id: actorId,
      action: "studio.deployment.tracked",
      entity_type: "studio_deployment",
      entity_id: row.id,
      new_value: { subdomain: sub, lead_id: leadId, why: "the lead's website link is this staging site" },
    });
  }
  // best effort: one live row per lead is enforced by an index, so a lead that
  // already has one keeps it — the transfer is then told the lead directly
  if (!row.lead_id) await admin.from("studio_deployments").update({ lead_id: leadId }).eq("id", row.id).is("lead_id", null);
  return { id: row.id, url: row.url };
}

/**
 * The domain already serves the lead's site (uploaded by hand while the client
 * waited, or an earlier transfer): record it — the lead's website link becomes
 * the domain, it's logged and the lead's people are told. Nothing is copied,
 * overwritten or deleted.
 */
export async function recordSiteOnDomain(input: {
  admin: SupabaseClient;
  leadId: string;
  domain: string;
  actorId: string | null;
  how: "found_on_domain" | "marked_by_hand";
}): Promise<void> {
  const { admin, leadId, domain, actorId, how } = input;
  const url = `https://${domain}`;
  const { data } = await admin.from("leads").select("id, business_name, agent_id, closed_by, website_link").eq("id", leadId).maybeSingle();
  const lead = data as (LeadForNotice & { website_link: string | null }) | null;
  if (!lead) return;
  const prior = lead.website_link ?? null;
  if ((siteHostFrom(prior ?? "") ?? "").replace(/^www\./, "") === domain) return; // already pointing here
  await admin.from("leads").update({ website_link: url }).eq("id", leadId);
  await admin.from("activity_log").insert({
    user_id: actorId,
    action: "lead.website_on_domain",
    entity_type: "lead",
    entity_id: leadId,
    new_value: { from: prior, to: url, how },
  });
  await notifyWebsiteOnDomain(lead, domain, actorId, new Date().toISOString());
}
