import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { notify } from "@/lib/notifications/notify";
import {
  daConfigured,
  subFromWebsiteLink,
  archiveDocroot,
  createSubdomain,
  deleteSubdomain,
  subdomainExists,
  uploadZipAndExtract,
  docrootFor,
} from "@/lib/template-engine/directadmin";
import {
  baseSubdomain,
  parseVersion,
  firstFreeVersion,
} from "@/lib/site-studio/deploy/naming";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/site-studio/deployments/[id]/shuffle
 *
 * Move a live staging site to a FRESH subdomain: the current files are pulled
 * from the hosting (manual edits included), uploaded to the next free
 * versioned name ({first-2-words}vN), and only then is the old subdomain
 * deleted. The lead's website_link is repointed and the lead's agent notified.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;
  if (!daConfigured()) return NextResponse.json({ error: "DirectAdmin is not configured." }, { status: 422 });

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("studio_deployments")
    .select("id, lead_id, subdomain, url, status, leads(business_name, agent_id, closed_by)")
    .eq("id", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Deployment not found" }, { status: 404 });
  if (row.status !== "live") return NextResponse.json({ error: "Only a live site can be shuffled" }, { status: 409 });

  const daDomain = process.env.DA_DOMAIN ?? "";
  const oldSub = subFromWebsiteLink(row.url, daDomain) ?? (row.subdomain as string);
  if (!oldSub || !row.url.includes(`.${daDomain}`)) {
    return NextResponse.json({ error: "Only staging subdomains can be shuffled" }, { status: 409 });
  }

  const lead = (Array.isArray(row.leads) ? row.leads[0] : row.leads) as
    | { business_name: string; agent_id: string | null; closed_by: string | null }
    | null;

  // Next free versioned name. Base comes from the lead's business name when
  // linked, else from the current label; the old name itself is never reused.
  const base = lead?.business_name ? baseSubdomain(lead.business_name) : parseVersion(oldSub).base;
  let newSub: string;
  try {
    newSub = await firstFreeVersion(base, subdomainExists, {
      skip: oldSub,
      start: parseVersion(oldSub).base === base ? parseVersion(oldSub).version + 1 : 1,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No free subdomain" }, { status: 502 });
  }

  // 1. current live files
  const zip = await archiveDocroot(oldSub);
  if (!zip) return NextResponse.json({ error: "Could not read the current site files" }, { status: 502 });

  // 2. create + upload to the new subdomain; roll it back on failure
  const created = await createSubdomain(newSub);
  if (created.error) {
    return NextResponse.json({ error: `Could not create ${newSub}: ${created.text || created.details}` }, { status: 502 });
  }
  const uploaded = await uploadZipAndExtract(newSub, zip, "site.zip");
  if (!uploaded.ok && uploaded.failedStep !== "delete") {
    await deleteSubdomain(newSub); // rollback — the old site is untouched
    return NextResponse.json(
      { error: `Upload to ${newSub} failed at ${uploaded.failedStep}: ${uploaded.message ?? "error"} — the old site is untouched.` },
      { status: 502 },
    );
  }

  // 3. the new site is live — repoint records, then drop the old subdomain
  const newUrl = `https://${newSub}.${daDomain}`;
  const now = new Date().toISOString();
  const { error: updErr } = await admin
    .from("studio_deployments")
    .update({ subdomain: newSub, docroot: docrootFor(newSub), url: newUrl, updated_at: now })
    .eq("id", id);
  if (updErr) {
    return NextResponse.json(
      { error: `New site is live at ${newUrl}, but recording it failed: ${updErr.message}. Old subdomain kept.` },
      { status: 500 },
    );
  }
  if (row.lead_id) {
    await admin.from("leads").update({ website_link: newUrl }).eq("id", row.lead_id);
  }
  await admin.from("builder_runs").update({ deployed_url: newUrl, updated_at: now }).eq("deployed_url", row.url);

  const removed = await deleteSubdomain(oldSub);

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "studio.deployment.shuffled",
    entity_type: "studio_deployment",
    entity_id: id,
    new_value: { from: oldSub, to: newSub, old_deleted: !removed.error, lead_id: row.lead_id },
  });

  if (row.lead_id && lead) {
    try {
      await notify(
        "website_link_added",
        { leadId: row.lead_id, lead: { agent_id: lead.agent_id, closed_by: lead.closed_by }, actorId: auth.userId },
        {
          title: "Website moved to a new link",
          body: `${lead.business_name}'s website has a new address: ${newUrl}`,
          dedupKey: `website_shuffled:${row.lead_id}:${newSub}`,
          targetUrl: `/leads/${row.lead_id}`,
          websiteUrl: newUrl,
        },
      );
    } catch {}
  }

  return NextResponse.json({ ok: true, url: newUrl, subdomain: newSub, oldDeleted: !removed.error });
}
