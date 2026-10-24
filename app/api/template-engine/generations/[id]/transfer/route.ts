import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { linkedSiteRefusal, noteWebsiteLinkChange } from "@/lib/sedcms/links";
import { notify } from "@/lib/notifications/notify";
import { daConfigured, subFromWebsiteLink, deleteSubdomain } from "@/lib/template-engine/directadmin";
import { hostingerConfigured } from "@/lib/hostinger/client";
import { normalizeTargetDomain, probeSite, pushStagingToDomain } from "@/lib/site-studio/deploy/transfer";

export const runtime = "nodejs";
// A brand-new domain's hosting setup alone can take a few minutes.
export const maxDuration = 600;

// POST /api/template-engine/generations/[id]/transfer  body { domain }
//
// Promote a client's approved v2 staging site to their real domain. The
// hosting work is the board's shared pushStagingToDomain (target checks,
// website setup, snapshot, deploy, SSL); this route repoints the lead + the
// generation and deletes the staging subdomain once the files are confirmed
// in place on the domain.
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

  const daDomain = process.env.DA_DOMAIN ?? "";
  const body = (await req.json().catch(() => ({}))) as { domain?: unknown };
  const target = normalizeTargetDomain(body.domain, daDomain);
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: 422 });
  const domain = target.domain;

  const admin = createAdminClient();
  try {
    const { data: gen } = await admin
      .from("template_generations")
      .select("id, lead_id, status, deployed_url")
      .eq("id", id)
      .maybeSingle();
    if (!gen) return NextResponse.json({ error: "Generation not found" }, { status: 404 });
    if (gen.status !== "deployed" || typeof gen.deployed_url !== "string") {
      return NextResponse.json({ error: "Only a deployed (staged) site can be transferred" }, { status: 409 });
    }
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
    // Moving the site to a domain moves its address: on a lead SED CMS is
    // turned on for, that is a manager's call (lib/sedcms/links.ts).
    const linkedRefusal = await linkedSiteRefusal(admin, gen.lead_id, perms);
    if (linkedRefusal) return NextResponse.json({ error: linkedRefusal.error }, { status: linkedRefusal.status });

    const now = new Date().toISOString();
    const pushed = await pushStagingToDomain({ admin, sub, domain, nowIso: now });
    if (!pushed.ok) {
      if (!pushed.pending) {
        console.error(`[transfer:v2] ${id} -> ${domain} failed at ${pushed.step}: ${pushed.error}`);
        await Promise.resolve(
          admin.from("activity_log").insert({
            user_id: user.id,
            action: "lead.website_transfer_failed",
            entity_type: "lead",
            entity_id: gen.lead_id,
            new_value: { domain, step: pushed.step, error: pushed.error, generation_id: id },
          }),
        ).catch(() => {});
      }
      return NextResponse.json({ error: pushed.error, pending: pushed.pending ?? false }, { status: pushed.status });
    }

    const url = `https://${domain}`;
    const reachable = await probeSite(domain);

    await admin
      .from("template_generations")
      .update({ deployed_url: url, updated_at: now })
      .eq("id", id)
      .eq("status", "deployed");
    const priorLink = lead.website_link;
    await admin.from("leads").update({ website_link: url }).eq("id", gen.lead_id);
    await noteWebsiteLinkChange(admin, { leadId: gen.lead_id, before: priorLink, after: url, actorId: user.id });

    let subdomainDeleted = false;
    if (pushed.settled) {
      const removed = await deleteSubdomain(sub);
      subdomainDeleted = !removed.error;
    }

    await admin.from("activity_log").insert({
      user_id: user.id,
      action: "lead.website_transferred",
      entity_type: "lead",
      entity_id: gen.lead_id,
      new_value: {
        from: gen.deployed_url,
        to: url,
        subdomain_deleted: subdomainDeleted,
        generation_id: id,
        settled: pushed.settled,
        snapshot: pushed.snapshot,
        ssl: pushed.ssl,
      },
    });

    if (url !== priorLink) {
      try {
        await notify(
          "website_link_added",
          { leadId: gen.lead_id, lead: { agent_id: lead.agent_id, closed_by: lead.closed_by }, actorId: user.id },
          {
            title: "Website on custom domain",
            body: `${lead.business_name}'s website is now live at ${url}`,
            dedupKey: `website_link_added:${gen.lead_id}:${now}`,
            targetUrl: `/leads/${gen.lead_id}`,
            websiteUrl: url,
          },
        );
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
    console.error(`[transfer:v2] ${id} -> ${domain} crashed: ${message}`);
    return NextResponse.json({ error: `Transfer failed unexpectedly: ${message}` }, { status: 500 });
  }
}
