import { requireWebsite, websiteAuthError } from "@/lib/website-cms/guard";
import { WEBSITE_LEAD_STATUSES } from "@/lib/website-cms/types";

export const runtime = "nodejs";

// GET ?status=new|...|spam|all — newest first.
export async function GET(req: Request) {
  const auth = await requireWebsite("view");
  if ("error" in auth) return websiteAuthError(auth.error);

  const status = new URL(req.url).searchParams.get("status") ?? "all";
  let query = auth.admin.from("website_leads").select("*").order("created_at", { ascending: false }).limit(500);
  if (status === "spam") query = query.eq("is_spam", true);
  else {
    query = query.eq("is_spam", false);
    if ((WEBSITE_LEAD_STATUSES as readonly string[]).includes(status)) query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ rows: data ?? [] });
}
