import { requireWebsite, websiteAuthError } from "@/lib/website-cms/guard";
import { WEBSITE_COLLECTIONS } from "@/lib/website-cms/collections";
import { notifyWebsite } from "@/lib/website-cms/publish";

export const runtime = "nodejs";

function notFound() {
  return Response.json({ error: "Unknown collection" }, { status: 404 });
}

export async function GET(_req: Request, { params }: { params: Promise<{ collection: string }> }) {
  const { collection } = await params;
  const col = WEBSITE_COLLECTIONS[collection];
  if (!col) return notFound();
  const auth = await requireWebsite("view");
  if ("error" in auth) return websiteAuthError(auth.error);

  let query = auth.admin.from(col.table).select("*");
  for (const o of col.orderBy) query = query.order(o.column, { ascending: o.ascending });
  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ rows: data ?? [] });
}

export async function POST(req: Request, { params }: { params: Promise<{ collection: string }> }) {
  const { collection } = await params;
  const col = WEBSITE_COLLECTIONS[collection];
  if (!col) return notFound();
  const auth = await requireWebsite("manage");
  if ("error" in auth) return websiteAuthError(auth.error);

  const body = await req.json().catch(() => ({}));
  const parsed = col.schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }

  const { data, error } = await auth.admin.from(col.table).insert(parsed.data).select("id").single();
  if (error) {
    if (error.code === "23505") {
      return Response.json({ error: "A row with that slug/code already exists." }, { status: 422 });
    }
    return Response.json({ error: error.message }, { status: 400 });
  }

  await auth.admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "website.created",
    entity_type: col.table,
    entity_id: data.id,
    new_value: parsed.data,
  });

  const publish = col.tags.length > 0 ? await notifyWebsite(col.tags) : null;
  return Response.json({ id: data.id, publish }, { status: 201 });
}
