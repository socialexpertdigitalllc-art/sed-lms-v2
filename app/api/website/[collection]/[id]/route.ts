import { requireWebsite, websiteAuthError } from "@/lib/website-cms/guard";
import { WEBSITE_COLLECTIONS } from "@/lib/website-cms/collections";
import { notifyWebsite } from "@/lib/website-cms/publish";

export const runtime = "nodejs";

type Params = { params: Promise<{ collection: string; id: string }> };

function notFound(what: string) {
  return Response.json({ error: `Unknown ${what}` }, { status: 404 });
}

export async function PUT(req: Request, { params }: Params) {
  const { collection, id } = await params;
  const col = WEBSITE_COLLECTIONS[collection];
  if (!col) return notFound("collection");
  const auth = await requireWebsite("manage");
  if ("error" in auth) return websiteAuthError(auth.error);

  const body = await req.json().catch(() => ({}));
  const parsed = col.schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }

  const { data, error } = await auth.admin
    .from(col.table)
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      return Response.json({ error: "A row with that slug/code already exists." }, { status: 422 });
    }
    return Response.json({ error: error.message }, { status: 400 });
  }
  if (!data) return notFound("row");

  await auth.admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "website.updated",
    entity_type: col.table,
    entity_id: id,
    new_value: parsed.data,
  });

  const publish = col.tags.length > 0 ? await notifyWebsite(col.tags) : null;
  return Response.json({ ok: true, publish });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { collection, id } = await params;
  const col = WEBSITE_COLLECTIONS[collection];
  if (!col) return notFound("collection");
  const auth = await requireWebsite("manage");
  if ("error" in auth) return websiteAuthError(auth.error);

  const { data, error } = await auth.admin
    .from(col.table)
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!data) return notFound("row");

  await auth.admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "website.deleted",
    entity_type: col.table,
    entity_id: id,
  });

  const publish = col.tags.length > 0 ? await notifyWebsite(col.tags) : null;
  return Response.json({ ok: true, publish });
}
