import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { daConfigured, deleteSubdomain, subFromWebsiteLink } from "@/lib/template-engine/directadmin";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/template-engine/generations/[id]/takedown — take a deployed site
// offline: delete its subdomain (and directory tree), clear the lead's
// website_link when it still points at that site, and put the generation back
// at `review` (its zip/preview remain, so it can be redeployed later).
// Deploy-privileged only, like the deploy route it reverses.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.deploy")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!daConfigured()) {
    return NextResponse.json({ error: "Deployment is not configured." }, { status: 422 });
  }

  const admin = createAdminClient();
  const { data: gen } = await admin
    .from("template_generations")
    .select("id, lead_id, status, deployed_url")
    .eq("id", id)
    .maybeSingle();
  if (!gen) return NextResponse.json({ error: "Generation not found" }, { status: 404 });
  if (gen.status !== "deployed" || typeof gen.deployed_url !== "string" || !gen.deployed_url) {
    return NextResponse.json({ error: "Only a deployed site can be taken down" }, { status: 409 });
  }

  const domain = process.env.DA_DOMAIN ?? "";
  const sub = subFromWebsiteLink(gen.deployed_url, domain);
  if (!sub) {
    return NextResponse.json({ error: `Deployed URL is not on ${domain} — take it down manually` }, { status: 422 });
  }

  const removed = await deleteSubdomain(sub);
  if (removed.error) {
    const message = removed.text || removed.details || "subdomain deletion failed";
    return NextResponse.json({ error: `Could not delete the subdomain: ${message}` }, { status: 502 });
  }

  // CAS back to review so a concurrent redeploy can't be silently clobbered.
  const { data: flipped, error: flipErr } = await admin
    .from("template_generations")
    .update({ status: "review", deployed_url: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "deployed")
    .select("id")
    .maybeSingle();
  if (flipErr) return NextResponse.json({ error: flipErr.message }, { status: 400 });
  if (!flipped) return NextResponse.json({ error: "Generation changed during take-down" }, { status: 409 });

  // Clear the lead's website_link ONLY when it still points at this site —
  // never wipe a link someone has since repointed elsewhere. A "Ready" lead's
  // link cannot be cleared (DB trigger requires it), so it is left in place
  // and the response says so.
  let warning: string | undefined;
  const { data: lead } = await admin.from("leads").select("id, status, website_link").eq("id", gen.lead_id).maybeSingle();
  if (lead && typeof lead.website_link === "string" && subFromWebsiteLink(lead.website_link, domain) === sub) {
    if (lead.status === "Ready") {
      warning = "The lead is Ready, so its website link was kept (now pointing at a removed site). Set the lead to Not Ready or deploy a new site.";
    } else {
      const { error: clearErr } = await admin.from("leads").update({ website_link: null }).eq("id", gen.lead_id);
      if (clearErr) warning = `Site removed, but clearing the lead link failed: ${clearErr.message}`;
    }
  }

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "lead.website_taken_down",
    entity_type: "lead",
    entity_id: gen.lead_id,
    new_value: { removed_url: gen.deployed_url, generation_id: id },
  });

  return NextResponse.json({ ok: true, warning });
}
