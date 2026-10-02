import { requireWebsite, websiteAuthError } from "@/lib/website-cms/guard";
import { websiteLeadUpdateSchema } from "@/lib/website-cms/schema";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const auth = await requireWebsite("manage");
  if ("error" in auth) return websiteAuthError(auth.error);

  const body = await req.json().catch(() => ({}));
  const parsed = websiteLeadUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }

  const patch: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
  if (parsed.data.is_spam === true) patch.spam_reason = "manual";
  if (parsed.data.is_spam === false) patch.spam_reason = null;
  // First move out of "new" stamps when the lead was first worked.
  if (parsed.data.status && parsed.data.status !== "new") {
    const { data: current } = await auth.admin.from("website_leads").select("contacted_at").eq("id", id).maybeSingle();
    if (current && !current.contacted_at) {
      patch.contacted_at = new Date().toISOString();
      patch.assigned_to = auth.userId;
    }
  }

  const { data, error } = await auth.admin.from("website_leads").update(patch).eq("id", id).select("id").maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!data) return Response.json({ error: "Lead not found" }, { status: 404 });

  await auth.admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "website.lead_updated",
    entity_type: "website_leads",
    entity_id: id,
    new_value: parsed.data,
  });

  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const auth = await requireWebsite("manage");
  if ("error" in auth) return websiteAuthError(auth.error);

  const { data, error } = await auth.admin.from("website_leads").delete().eq("id", id).select("id").maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!data) return Response.json({ error: "Lead not found" }, { status: 404 });

  await auth.admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "website.lead_deleted",
    entity_type: "website_leads",
    entity_id: id,
  });
  return Response.json({ ok: true });
}
