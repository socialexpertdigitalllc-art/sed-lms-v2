import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { deleteSubdomain, subFromWebsiteLink } from "@/lib/template-engine/directadmin";
import { hostingerConfigured, deleteWebsite } from "@/lib/hostinger/client";
import { isProtectedDomain } from "@/lib/site-studio/deploy/protected";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

/**
 * DELETE /api/site-studio/deployments/[id] — takedown. Re-implements the v2
 * takedown route's contract (`app/api/template-engine/generations/[id]/
 * takedown/route.ts`) against `studio_deployments` instead of
 * `template_generations`. `deleteSubdomain` from `lib/template-engine/
 * directadmin` is a sanctioned kept import here — Site Studio deploy code is
 * the one place still allowed to reach into the v2 DirectAdmin layer.
 *
 * Already-taken-down is refused (409) BEFORE the DirectAdmin call — no
 * reason to hit real infra for a site that's already gone, and it keeps a
 * double-submit from racing itself.
 *
 * The DirectAdmin call itself gates every row mutation below: if it fails,
 * this function returns the error immediately and never touches the row. A
 * `taken_down` row is a claim that the site is gone — flipping it while the
 * subdomain is still live and serving would be a worse failure mode than a
 * visible error, because nothing would ever prompt a retry.
 */
export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const mode = new URL(req.url).searchParams.get("mode");

  const admin = createAdminClient();
  const { data: row, error: fetchErr } = await admin
    .from("studio_deployments")
    .select("id, lead_id, subdomain, url, status")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 400 });
  if (!row) return NextResponse.json({ error: "Deployment not found" }, { status: 404 });

  // `?mode=record` — delete a NON-LIVE row from the board entirely. No infra
  // is touched (the site is already gone or never existed); this is pure
  // bookkeeping removal, refused for live rows precisely because deleting a
  // live row would orphan a site that is still serving.
  if (mode === "record") {
    if (row.status === "live") {
      return NextResponse.json({ error: "This site is live — take it down first, then delete the record." }, { status: 409 });
    }
    const { error: delErr } = await admin.from("studio_deployments").delete().eq("id", id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });
    await admin.from("activity_log").insert({
      user_id: auth.userId,
      action: "studio.deployment.record_deleted",
      entity_type: "studio_deployment",
      entity_id: id,
      new_value: { subdomain: row.subdomain, url: row.url, status: row.status },
    });
    return NextResponse.json({ ok: true });
  }

  if (row.status === "taken_down") {
    return NextResponse.json({ error: "This site is already taken down" }, { status: 409 });
  }

  // A transferred site lives on a CUSTOM domain (its url no longer points at
  // a DA subdomain) — takedown there removes the Hostinger addon website
  // instead of a DirectAdmin subdomain.
  const daDomain = process.env.DA_DOMAIN ?? "";
  const sub = subFromWebsiteLink(row.url, daDomain);
  if (sub) {
    const removed = await deleteSubdomain(sub);
    if (removed.error) {
      const message = removed.text || removed.details || "subdomain deletion failed";
      return NextResponse.json({ error: `Could not delete the subdomain: ${message}` }, { status: 502 });
    }
  } else {
    const domain = row.url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (isProtectedDomain(domain)) {
      return NextResponse.json(
        { error: `${domain} is a protected company domain — it cannot be taken down from the board.` },
        { status: 403 },
      );
    }
    if (!hostingerConfigured()) {
      return NextResponse.json(
        { error: `This site lives on ${domain} (custom domain) and Hostinger is not configured to remove it.` },
        { status: 422 },
      );
    }
    const removed = await deleteWebsite(domain);
    if (!removed.ok) {
      return NextResponse.json({ error: `Could not remove ${domain} from hosting: ${removed.message ?? "failed"}` }, { status: 502 });
    }
  }

  // CAS on status (not just id) so a concurrent double-submit that raced past
  // the guard above can't both flip the same row and, e.g., double-clear a
  // lead link out from under a redeploy.
  const now = new Date().toISOString();
  const { data: flipped, error: flipErr } = await admin
    .from("studio_deployments")
    .update({ status: "taken_down", taken_down_at: now, updated_at: now })
    .eq("id", id)
    .neq("status", "taken_down")
    .select("id")
    .maybeSingle();
  if (flipErr) return NextResponse.json({ error: flipErr.message }, { status: 400 });
  if (!flipped) return NextResponse.json({ error: "Deployment changed during take-down" }, { status: 409 });

  // Clear the lead's website_link ONLY if it still matches THIS deployment's
  // URL. A later deployment (redeploy to a new subdomain, or a different run
  // entirely) may have already superseded it and repointed the link — that
  // newer, still-live site's link must never be clobbered by an older
  // deployment's takedown.
  let warning: string | undefined;
  if (row.lead_id) {
    const { data: lead, error: leadErr } = await admin
      .from("leads")
      .select("id, website_link")
      .eq("id", row.lead_id)
      .maybeSingle();
    if (leadErr) {
      warning = `Site removed, but checking the lead link failed: ${leadErr.message}`;
    } else if (lead && lead.website_link === row.url) {
      const { error: clearErr } = await admin.from("leads").update({ website_link: null }).eq("id", row.lead_id);
      if (clearErr) warning = `Site removed, but clearing the lead link failed: ${clearErr.message}`;
    }
  }

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "studio.deployment.taken_down",
    entity_type: "studio_deployment",
    entity_id: id,
    new_value: { subdomain: row.subdomain, url: row.url, lead_id: row.lead_id },
  });

  return NextResponse.json({ ok: true, warning });
}
