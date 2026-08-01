import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { notify } from "@/lib/notifications/notify";
import { daConfigured, subFromWebsiteLink, archiveDocroot, deleteSubdomain } from "@/lib/template-engine/directadmin";
import { hostingerConfigured, listDomains, ensureWebsite } from "@/lib/hostinger/client";
import { deployZipToDir } from "@/lib/template-engine/fsDeploy";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/site-studio/deployments/[id]/transfer  body { domain }
 *
 * Promote a live staging deployment (any origin — studio, builder, or a v2
 * import) to the client's real domain. This is the v2 transfer flow
 * (`app/api/template-engine/generations/[id]/transfer/route.ts`) carried
 * over AS IS, re-keyed from `template_generations` to `studio_deployments`
 * so the one deployments board serves every system:
 *   1. Pull the CURRENT files from the live subdomain (captures manual edits
 *      made directly on the docroot — not the generator zip).
 *   2. Ensure the domain is an addon website on the Hostinger plan.
 *   3. Write those files straight into the addon docroot on disk (the LMS
 *      runs on the same Hostinger account — the confirmed deploy method).
 *   4. Repoint the deployment row + the lead's website_link (+ any builder
 *      run that recorded the staging URL) to the custom domain.
 *   5. Delete the now-redundant staging subdomain (best-effort).
 */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  if (!daConfigured()) return NextResponse.json({ error: "DirectAdmin is not configured." }, { status: 422 });
  if (!hostingerConfigured()) return NextResponse.json({ error: "Hostinger is not configured." }, { status: 422 });

  const body = (await req.json().catch(() => ({}))) as { domain?: unknown };
  const domain = typeof body.domain === "string" ? body.domain.trim().toLowerCase() : "";
  if (!domain) return NextResponse.json({ error: "Pick a domain to transfer to" }, { status: 422 });

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("studio_deployments")
    .select("id, lead_id, subdomain, url, status, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Deployment not found" }, { status: 404 });
  if (row.status !== "live") {
    return NextResponse.json({ error: "Only a live site can be transferred" }, { status: 409 });
  }

  const daDomain = process.env.DA_DOMAIN ?? "";
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

  // The target domain must be one the account actually owns.
  const owned = await listDomains();
  if (!owned.some((d) => d.domain.toLowerCase() === domain)) {
    return NextResponse.json({ error: `${domain} is not a registered domain on this account` }, { status: 422 });
  }

  // 1. fresh files from the live subdomain
  const zip = await archiveDocroot(sub);
  if (!zip) {
    return NextResponse.json({ error: "Could not read the current subdomain files to transfer" }, { status: 502 });
  }

  // 2. ensure the addon website + get its on-disk docroot
  const site = await ensureWebsite(domain);
  if (!site.ok || !site.website) {
    return NextResponse.json({ error: `Could not set up hosting for ${domain}: ${site.message ?? "unknown"}` }, { status: 502 });
  }

  // 3. write the files into the addon docroot (LMS shares the hosting account)
  try {
    await deployZipToDir(zip, site.website.root_directory);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "write failed";
    return NextResponse.json({ error: `Could not write the site to ${domain}: ${msg}` }, { status: 502 });
  }

  // 4. quick, non-blocking reachability check (cert/vhost provisioning is async)
  const url = `https://${domain}`;
  let reachable = false;
  for (const scheme of ["https", "http"] as const) {
    try {
      const res = await fetch(`${scheme}://${domain}/`, { signal: AbortSignal.timeout(4000) });
      if (res.ok || res.status === 301 || res.status === 308) {
        reachable = true;
        break;
      }
    } catch {
      // provisioning
    }
  }

  // 5. repoint the deployment row, the lead, and any builder run that
  //    recorded the staging URL
  const priorUrl = row.url as string;
  const now = new Date().toISOString();
  await admin
    .from("studio_deployments")
    .update({ url, docroot: site.website.root_directory, updated_at: now })
    .eq("id", id)
    .eq("status", "live");
  const priorLink = lead?.website_link ?? null;
  if (row.lead_id) await admin.from("leads").update({ website_link: url }).eq("id", row.lead_id);
  await admin.from("builder_runs").update({ deployed_url: url, updated_at: now }).eq("deployed_url", priorUrl);

  // 6. delete the staging subdomain (best-effort — the site is already live
  //    on the custom domain; a delete hiccup only leaves a stale staging URL).
  const removed = await deleteSubdomain(sub);
  const subdomainDeleted = !removed.error;

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "studio.deployment.transferred",
    entity_type: "studio_deployment",
    entity_id: id,
    new_value: { from: priorUrl, to: url, subdomain_deleted: subdomainDeleted, lead_id: row.lead_id },
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

  return NextResponse.json({ url, provisioning: !reachable, subdomainDeleted });
}
