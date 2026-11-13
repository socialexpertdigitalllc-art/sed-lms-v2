import type { SupabaseClient } from "@supabase/supabase-js";
import { noteWebsiteLinkChange } from "@/lib/sedcms/links";

/**
 * A freshly published website waits for the developer before anyone else sees
 * it (migration 0101, table lead_site_reviews).
 *
 *   publish  → putSiteInReview: the link is saved for developers only, and
 *              they are notified. leads.website_link is NOT touched — it stays
 *              empty, or on the last finished site for a redesign.
 *   Finalize → finalizeSiteReview: the link becomes leads.website_link for
 *              everyone; the agent and closer get "Website live".
 *
 * Developers are whoever holds tickets.resolve or studio.manage (the Tech and
 * Admin departments by default). If the table isn't there yet (migration not
 * applied), publishing falls back to the old behaviour rather than failing.
 */

export const SITE_REVIEW_TABLE = "lead_site_reviews";
export type SiteReviewSource = "site_builder" | "site_studio" | "template_engine";

export type SiteReview = {
  lead_id: string;
  url: string;
  source: string;
  run_id: string | null;
  published_by: string | null;
  published_at: string;
};

/** Can this person see sites in review and finalize them? */
export function isSiteDeveloper(perms: { has(key: string): boolean }): boolean {
  return perms.has("tickets.resolve") || perms.has("studio.manage");
}

function missingTable(message: string | undefined): boolean {
  return !!message && /lead_site_reviews|relation .* does not exist|schema cache/i.test(message);
}

export async function loadSiteReview(admin: SupabaseClient, leadId: string): Promise<SiteReview | null> {
  const { data, error } = await admin.from(SITE_REVIEW_TABLE).select("*").eq("lead_id", leadId).maybeSingle();
  if (error || !data) return null;
  return data as SiteReview;
}

/**
 * The address the lead's site lives at for a REDEPLOY: the one in review if
 * there is one, else the finished link. A re-publish keeps its subdomain
 * instead of minting a new one each time.
 */
export async function currentSiteLink(admin: SupabaseClient, lead: { id: string; website_link?: unknown }): Promise<string | null> {
  const review = await loadSiteReview(admin, lead.id);
  if (review?.url) return review.url;
  return typeof lead.website_link === "string" && lead.website_link ? lead.website_link : null;
}

type Lead = { id: string; business_name?: unknown; agent_id?: unknown; closed_by?: unknown; website_link?: unknown };

/** Publish: the new site waits for the developer. Returns how it was handled. */
export async function putSiteInReview(
  admin: SupabaseClient,
  args: { lead: Lead; url: string; source: SiteReviewSource; runId?: string | null; actorId: string | null },
): Promise<{ inReview: true } | { inReview: false; fallback: true } | { error: string }> {
  const { lead, url } = args;
  const { error } = await admin.from(SITE_REVIEW_TABLE).upsert(
    {
      lead_id: lead.id,
      url,
      source: args.source,
      run_id: args.runId ?? null,
      published_by: args.actorId,
      published_at: new Date().toISOString(),
    },
    { onConflict: "lead_id" },
  );
  if (error) {
    if (!missingTable(error.message)) return { error: error.message };
    // Migration 0101 not applied yet: publish the old way rather than fail.
    const { error: linkErr } = await admin.from("leads").update({ website_link: url }).eq("id", lead.id);
    if (linkErr) return { error: linkErr.message };
    await noteWebsiteLinkChange(admin, { leadId: lead.id, after: url, actorId: args.actorId });
    await notifyLive(lead, url, args.actorId);
    return { inReview: false, fallback: true };
  }

  await admin.from("activity_log").insert({
    user_id: args.actorId,
    action: "lead.website_in_review",
    entity_type: "lead",
    entity_id: lead.id,
    new_value: { url, source: args.source, run_id: args.runId ?? null },
  });
  try {
    const { notify } = await import("@/lib/notifications/notify");
    await notify(
      "website_in_review",
      { leadId: lead.id, actorId: args.actorId },
      {
        title: "Website ready for your review",
        body: `${String(lead.business_name ?? "A lead")}'s new website is published and waiting for you to finalize it: ${url}`,
        dedupKey: `website_in_review:${lead.id}:${url}:${Date.now()}`,
        targetUrl: `/leads/${lead.id}`,
        websiteUrl: url,
      },
    );
  } catch {
    /* a notification is never worth failing a publish over */
  }
  return { inReview: true };
}

async function notifyLive(lead: Lead, url: string, actorId: string | null): Promise<void> {
  try {
    const { notify } = await import("@/lib/notifications/notify");
    await notify(
      "website_link_added",
      {
        leadId: lead.id,
        lead: { agent_id: (lead.agent_id as string | null) ?? null, closed_by: (lead.closed_by as string | null) ?? null },
        actorId,
      },
      {
        title: "Website live",
        body: `${String(lead.business_name ?? "This lead")}'s website is live: ${url}`,
        dedupKey: `website_link_added:${lead.id}:${url}`,
        targetUrl: `/leads/${lead.id}`,
        websiteUrl: url,
      },
    );
  } catch {
    /* best effort */
  }
}

/** Finalize: the reviewed site becomes the lead's website for everyone. */
export async function finalizeSiteReview(
  admin: SupabaseClient,
  args: { leadId: string; actorId: string },
): Promise<{ ok: true; url: string } | { error: string; status: number }> {
  const review = await loadSiteReview(admin, args.leadId);
  if (!review) return { error: "There is no website waiting to be finalized on this lead.", status: 404 };
  const { data: leadRow, error: leadErr } = await admin
    .from("leads")
    .select("id, business_name, agent_id, closed_by, website_link")
    .eq("id", args.leadId)
    .maybeSingle();
  if (leadErr || !leadRow) return { error: "Lead not found", status: 404 };
  const lead = leadRow as Lead;
  const before = typeof lead.website_link === "string" ? lead.website_link : null;

  const { error: linkErr } = await admin.from("leads").update({ website_link: review.url }).eq("id", args.leadId);
  if (linkErr) return { error: linkErr.message, status: 500 };
  // Only clear the review that was finalized (a re-publish meanwhile stays).
  await admin.from(SITE_REVIEW_TABLE).delete().eq("lead_id", args.leadId).eq("url", review.url);
  await noteWebsiteLinkChange(admin, { leadId: args.leadId, before, after: review.url, actorId: args.actorId });
  await admin.from("activity_log").insert({
    user_id: args.actorId,
    action: "lead.website_finalized",
    entity_type: "lead",
    entity_id: args.leadId,
    old_value: { website_link: before },
    new_value: { website_link: review.url, published_at: review.published_at, source: review.source },
  });
  await notifyLive(lead, review.url, args.actorId);
  return { ok: true, url: review.url };
}

/** The bare host of a site address ("https://X.com/a" → "x.com"), or null. */
function hostOf(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase().replace(/\.$/, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

/** Do two addresses point at the same site? (scheme, case, path ignored) */
export function sameSite(a: string | null | undefined, b: string | null | undefined): boolean {
  const ha = hostOf(a);
  return !!ha && ha === hostOf(b);
}

/**
 * A site in review moved to a new address (shuffle, a new uploaded version):
 * the review follows it. Matched on the lead when known, else on the address.
 */
export async function repointSiteReview(
  admin: SupabaseClient,
  args: { leadId?: string | null; fromUrl: string; toUrl: string },
): Promise<void> {
  try {
    if (args.leadId) {
      const review = await loadSiteReview(admin, args.leadId);
      if (review && sameSite(review.url, args.fromUrl)) {
        await admin.from(SITE_REVIEW_TABLE).update({ url: args.toUrl }).eq("lead_id", args.leadId);
      }
      return;
    }
    await admin.from(SITE_REVIEW_TABLE).update({ url: args.toUrl }).eq("url", args.fromUrl);
  } catch {
    /* table absent: nothing in review */
  }
}

/**
 * The site in review was taken down or deleted: nothing left to finalize.
 * With `site`, only a review of THAT site is cleared (a newer one stays).
 */
export async function clearSiteReview(admin: SupabaseClient, args: { leadId: string; site?: string | null }): Promise<void> {
  try {
    const review = await loadSiteReview(admin, args.leadId);
    if (!review) return;
    if (args.site !== undefined && !sameSite(review.url, args.site)) return;
    await admin.from(SITE_REVIEW_TABLE).delete().eq("lead_id", args.leadId).eq("url", review.url);
  } catch {
    /* table absent: nothing in review */
  }
}
