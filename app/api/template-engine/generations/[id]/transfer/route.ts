import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { notify } from "@/lib/notifications/notify";
import { daConfigured, subFromWebsiteLink, archiveDocroot, deleteSubdomain } from "@/lib/template-engine/directadmin";
import { hostingerConfigured, listDomains, ensureWebsite } from "@/lib/hostinger/client";
import { deployZipToDir } from "@/lib/template-engine/fsDeploy";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/template-engine/generations/[id]/transfer  body { domain }
//
// Promote a client's approved staging site to their real domain:
//   1. Pull the CURRENT files from the live dmviral subdomain (captures any
//      manual edits made directly to the subdomain — not the generator zip).
//   2. Ensure the domain is an addon website on the Hostinger plan.
//   3. Write those files straight into the addon docroot on disk (the LMS runs
//      on the same Hostinger account — the confirmed deploy method).
//   4. Repoint the lead's website_link to the custom domain.
//   5. Delete the now-redundant dmviral subdomain.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.deploy")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!daConfigured()) return NextResponse.json({ error: "DirectAdmin is not configured." }, { status: 422 });
  if (!hostingerConfigured()) return NextResponse.json({ error: "Hostinger is not configured." }, { status: 422 });

  const body = (await req.json().catch(() => ({}))) as { domain?: unknown };
  const domain = typeof body.domain === "string" ? body.domain.trim().toLowerCase() : "";
  if (!domain) return NextResponse.json({ error: "Pick a domain to transfer to" }, { status: 422 });

  const admin = createAdminClient();
  const { data: gen } = await admin
    .from("template_generations")
    .select("id, lead_id, status, deployed_url")
    .eq("id", id)
    .maybeSingle();
  if (!gen) return NextResponse.json({ error: "Generation not found" }, { status: 404 });
  if (gen.status !== "deployed" || typeof gen.deployed_url !== "string") {
    return NextResponse.json({ error: "Only a deployed (staged) site can be transferred" }, { status: 409 });
  }
  const daDomain = process.env.DA_DOMAIN ?? "";
  const sub = subFromWebsiteLink(gen.deployed_url, daDomain);
  if (!sub) {
    return NextResponse.json({ error: "This generation is not on a dmviral subdomain to transfer from" }, { status: 409 });
  }

  const { data: lead } = await admin
    .from("leads")
    .select("id, business_name, agent_id, closed_by, website_link")
    .eq("id", gen.lead_id)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

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

  // 5. repoint the lead + generation to the production domain
  await admin
    .from("template_generations")
    .update({ deployed_url: url, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "deployed");
  const priorLink = lead.website_link;
  await admin.from("leads").update({ website_link: url }).eq("id", gen.lead_id);

  // 6. delete the staging subdomain (best-effort — the site is already live on
  //    the custom domain; a delete hiccup only leaves a stale staging URL).
  const removed = await deleteSubdomain(sub);
  const subdomainDeleted = !removed.error;

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "lead.website_transferred",
    entity_type: "lead",
    entity_id: gen.lead_id,
    new_value: { from: gen.deployed_url, to: url, subdomain_deleted: subdomainDeleted, generation_id: id },
  });

  if (url !== priorLink) {
    try {
      await notify(
        "website_link_added",
        { leadId: gen.lead_id, lead: { agent_id: lead.agent_id, closed_by: lead.closed_by }, actorId: user.id },
        {
          title: "Website on custom domain",
          body: `${lead.business_name}'s website is now live at ${url}`,
          dedupKey: `website_link_added:${gen.lead_id}:${new Date().toISOString()}`,
          targetUrl: `/leads/${gen.lead_id}`,
        }
      );
    } catch {}
  }

  return NextResponse.json({ url, provisioning: !reachable, subdomainDeleted });
}
