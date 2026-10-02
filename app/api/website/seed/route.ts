import { requireWebsite, websiteAuthError } from "@/lib/website-cms/guard";
import { seedWebsiteCms } from "@/lib/website-cms/seed";
import { notifyWebsite } from "@/lib/website-cms/publish";

export const runtime = "nodejs";

// Fill empty CMS tables from the website's content snapshot. Idempotent:
// tables that already have rows are left alone.
export async function POST() {
  const auth = await requireWebsite("manage");
  if ("error" in auth) return websiteAuthError(auth.error);

  try {
    const result = await seedWebsiteCms(auth.admin);
    await auth.admin.from("activity_log").insert({
      user_id: auth.userId,
      action: "website.seeded",
      entity_type: "website_services",
      new_value: result,
    });
    const publish = result.seeded.length > 0 ? await notifyWebsite() : null;
    return Response.json({ ...result, publish });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Seed failed" },
      { status: 400 },
    );
  }
}
