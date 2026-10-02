import { requireWebsite, websiteAuthError } from "@/lib/website-cms/guard";
import { settingsSchema } from "@/lib/website-cms/schema";
import { getWebsiteSettings, invalidateWebsiteSettingsCache } from "@/lib/website-cms/settings";
import { notifyWebsite } from "@/lib/website-cms/publish";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireWebsite("view");
  if ("error" in auth) return websiteAuthError(auth.error);
  const s = await getWebsiteSettings();
  if (auth.canManage) {
    return Response.json({
      stats: s.stats,
      revalidate_url: s.revalidate_url,
      revalidate_secret: s.revalidate_secret,
      api_key: s.api_key,
      canManage: true,
    });
  }
  // Viewers see whether the hooks are configured, never the values.
  return Response.json({
    stats: s.stats,
    revalidate_url: s.revalidate_url,
    revalidate_secret: s.revalidate_secret ? "configured" : "",
    api_key: s.api_key ? "configured" : "",
    canManage: false,
  });
}

export async function PUT(req: Request) {
  const auth = await requireWebsite("manage");
  if ("error" in auth) return websiteAuthError(auth.error);

  const body = await req.json().catch(() => ({}));
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }

  const { error } = await auth.admin
    .from("website_settings")
    .upsert({ singleton: true, ...parsed.data, updated_at: new Date().toISOString() }, { onConflict: "singleton" });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  invalidateWebsiteSettingsCache();

  await auth.admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "website.settings_updated",
    entity_type: "website_settings",
    // Secrets stay out of the audit trail.
    new_value: { stats: parsed.data.stats, revalidate_url: parsed.data.revalidate_url },
  });

  // Stats render on the site, so purge that tag after a save.
  const publish = await notifyWebsite(["stats"]);
  return Response.json({ ok: true, publish });
}
