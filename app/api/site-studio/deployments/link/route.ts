import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { notify } from "@/lib/notifications/notify";
import { adoptSubdomain, retireOtherLiveRows } from "@/lib/site-studio/deploy/manage";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/site-studio/deployments/link  body { leadId, deploymentId? , subdomain? }
 *
 * Attach a deployed site to a lead. Accepts either a tracked row id or a bare
 * subdomain (untracked hosting subdomains are adopted as origin 'manual').
 * Updates the lead's website_link and notifies the lead's agent.
 */
export async function POST(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const body = (await req.json().catch(() => ({}))) as {
    leadId?: unknown;
    deploymentId?: unknown;
    subdomain?: unknown;
  };
  const leadId = typeof body.leadId === "string" ? body.leadId : "";
  const deploymentId = typeof body.deploymentId === "string" ? body.deploymentId : null;
  const subdomain =
    typeof body.subdomain === "string" ? body.subdomain.trim().toLowerCase() : null;
  if (!leadId || (!deploymentId && !subdomain)) {
    return NextResponse.json({ error: "leadId and a deploymentId or subdomain are required" }, { status: 422 });
  }
  if (subdomain && !/^[a-z0-9-]{1,63}$/.test(subdomain)) {
    return NextResponse.json({ error: "Invalid subdomain" }, { status: 422 });
  }

  const admin = createAdminClient();
  const { data: lead } = await admin
    .from("leads")
    .select("id, business_name, agent_id, closed_by")
    .eq("id", leadId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  let row;
  if (deploymentId) {
    const { data } = await admin
      .from("studio_deployments")
      .select("id, lead_id, subdomain, url, status, origin")
      .eq("id", deploymentId)
      .maybeSingle();
    if (!data) return NextResponse.json({ error: "Deployment not found" }, { status: 404 });
    row = data;
  } else {
    const adopted = await adoptSubdomain(admin, subdomain as string, auth.userId);
    if ("error" in adopted) return NextResponse.json({ error: adopted.error }, { status: 502 });
    row = adopted.row;
  }
  if (row.status !== "live") {
    return NextResponse.json({ error: "Only a live site can be linked to a lead" }, { status: 409 });
  }

  const retireErr = await retireOtherLiveRows(admin, leadId, row.id as string);
  if (retireErr) return NextResponse.json({ error: `Could not retire the lead's previous site: ${retireErr}` }, { status: 500 });

  const { error: updErr } = await admin
    .from("studio_deployments")
    .update({ lead_id: leadId, updated_at: new Date().toISOString() })
    .eq("id", row.id as string);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  const { error: leadErr } = await admin.from("leads").update({ website_link: row.url }).eq("id", leadId);
  if (leadErr) return NextResponse.json({ error: `Linked, but could not update the lead's website link: ${leadErr.message}` }, { status: 500 });

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "studio.deployment.linked",
    entity_type: "studio_deployment",
    entity_id: row.id,
    new_value: { lead_id: leadId, url: row.url, subdomain: row.subdomain },
  });

  try {
    await notify(
      "website_link_added",
      { leadId: lead.id, lead: { agent_id: lead.agent_id, closed_by: lead.closed_by }, actorId: auth.userId },
      {
        title: "Website live",
        body: `${lead.business_name}'s website is live: ${row.url}`,
        dedupKey: `website_link_added:${lead.id}:${row.url}`,
        targetUrl: `/leads/${lead.id}`,
        websiteUrl: row.url,
      },
    );
  } catch {}

  return NextResponse.json({ ok: true, deploymentId: row.id, url: row.url });
}
