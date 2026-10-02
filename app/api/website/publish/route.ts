import { requireWebsite, websiteAuthError } from "@/lib/website-cms/guard";
import { notifyWebsite } from "@/lib/website-cms/publish";
import { WEBSITE_TAGS, type WebsiteTag } from "@/lib/website-cms/types";

export const runtime = "nodejs";

// "Publish everything" — purges every content tag on the live website.
export async function POST(req: Request) {
  const auth = await requireWebsite("manage");
  if ("error" in auth) return websiteAuthError(auth.error);

  const body = (await req.json().catch(() => ({}))) as { tags?: unknown };
  const tags = Array.isArray(body.tags)
    ? (body.tags.filter((t): t is WebsiteTag => (WEBSITE_TAGS as readonly string[]).includes(t as string)) as WebsiteTag[])
    : undefined;

  const result = await notifyWebsite(tags);
  if (!result.ok) return Response.json({ error: result.error }, { status: 502 });

  await auth.admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "website.published",
    entity_type: "website_settings",
    new_value: { tags: result.tags },
  });

  return Response.json(result);
}
