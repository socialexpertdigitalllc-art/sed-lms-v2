import type { SupabaseClient } from "@supabase/supabase-js";
import { notify } from "@/lib/notifications/notify";
import { subFromWebsiteLink, deleteSubdomain } from "@/lib/template-engine/directadmin";
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

  const { data: lead } = row.lead_id
    ? await admin
        .from("leads")
        .select("id, business_name, agent_id, closed_by, website_link")
        .eq("id", row.lead_id)
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
  if (row.lead_id) await admin.from("leads").update({ website_link: url }).eq("id", row.lead_id);
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
      lead_id: row.lead_id,
      hosting_created: pushed.created,
      settled: pushed.settled,
      snapshot: pushed.snapshot,
      ssl: pushed.ssl,
    },
  });

  if (lead && url !== priorLink) {
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
            dedupKey: `website_link_added:${lead.id}:${now}`,
            targetUrl: `/leads/${lead.id}`,
            websiteUrl: url,
          },
        );
      }
    } catch {}
  }

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
