import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { notify } from "@/lib/notifications/notify";
import { daConfigured, subFromWebsiteLink, deleteSubdomain } from "@/lib/template-engine/directadmin";
import { hostingerConfigured } from "@/lib/hostinger/client";
import { normalizeTargetDomain, probeSite, pushStagingToDomain } from "@/lib/site-studio/deploy/transfer";

export const runtime = "nodejs";
// A brand-new domain's hosting setup alone can take a few minutes.
export const maxDuration = 600;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/site-studio/deployments/[id]/transfer  body { domain }
 *
 * Promote a live staging deployment (any origin — studio, builder, or a v2
 * import) to the client's real domain on the Hostinger plan. The hosting work
 * (target checks, website setup, snapshot, deploy, SSL) is
 * `pushStagingToDomain`; this route owns the deployment row:
 *   - repoints the row, the lead's website_link and any builder run that
 *     recorded the staging URL to the custom domain;
 *   - deletes the staging subdomain ONLY once Hostinger confirmed the files
 *     are in place — otherwise the staging copy stays as the fallback;
 *   - records failures in activity_log (they were invisible before: a crash
 *     here left no trace anywhere).
 */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  if (!daConfigured()) return NextResponse.json({ error: "DirectAdmin is not configured." }, { status: 422 });
  if (!hostingerConfigured()) return NextResponse.json({ error: "Hostinger is not configured." }, { status: 422 });

  const daDomain = process.env.DA_DOMAIN ?? "";
  const body = (await req.json().catch(() => ({}))) as { domain?: unknown };
  const target = normalizeTargetDomain(body.domain, daDomain);
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: 422 });
  const domain = target.domain;

  const admin = createAdminClient();
  const logFailure = async (step: string, error: string) => {
    console.error(`[transfer] ${id} -> ${domain} failed at ${step}: ${error}`);
    await Promise.resolve(
      admin.from("activity_log").insert({
        user_id: auth.userId,
        action: "studio.deployment.transfer_failed",
        entity_type: "studio_deployment",
        entity_id: id,
        new_value: { domain, step, error },
      }),
    ).catch(() => {});
  };

  try {
    const { data: row } = await admin
      .from("studio_deployments")
      .select("id, lead_id, subdomain, url, status, updated_at")
      .eq("id", id)
      .maybeSingle();
    if (!row) return NextResponse.json({ error: "Deployment not found" }, { status: 404 });
    if (row.status !== "live") {
      return NextResponse.json({ error: "Only a live site can be transferred" }, { status: 409 });
    }

    const sub = subFromWebsiteLink(row.url, daDomain);
    if (!sub) {
      return NextResponse.json(
        { error: "This site is not on a staging subdomain — it looks already transferred." },
        { status: 409 },
      );
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
      return NextResponse.json({ error: pushed.error, pending: pushed.pending ?? false }, { status: pushed.status });
    }

    const url = `https://${domain}`;
    const reachable = await probeSite(domain);

    // repoint the deployment row, the lead, and any builder run that recorded
    // the staging URL
    const priorUrl = row.url as string;
    await admin
      .from("studio_deployments")
      .update({ url, docroot: pushed.website.root_directory, updated_at: now })
      .eq("id", id)
      .eq("status", "live");
    const priorLink = lead?.website_link ?? null;
    if (row.lead_id) await admin.from("leads").update({ website_link: url }).eq("id", row.lead_id);
    await admin.from("builder_runs").update({ deployed_url: url, updated_at: now }).eq("deployed_url", priorUrl);

    // The staging copy is the fallback until Hostinger confirms the files are
    // in place; a delete hiccup only leaves a stale staging URL.
    let subdomainDeleted = false;
    if (pushed.settled) {
      const removed = await deleteSubdomain(sub);
      subdomainDeleted = !removed.error;
    }

    await admin.from("activity_log").insert({
      user_id: auth.userId,
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
          { leadId: lead.id, lead: { agent_id: lead.agent_id, closed_by: lead.closed_by }, actorId: auth.userId },
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
            { leadId: lead.id, lead: { agent_id: lead.agent_id, closed_by: lead.closed_by }, actorId: auth.userId },
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

    return NextResponse.json({
      url,
      provisioning: !reachable,
      subdomainDeleted,
      settled: pushed.settled,
      hostingCreated: pushed.created,
      snapshot: pushed.snapshot,
      snapshotError: pushed.snapshotError,
      ssl: pushed.ssl,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logFailure("unexpected", message);
    return NextResponse.json({ error: `Transfer failed unexpectedly: ${message}` }, { status: 500 });
  }
}
