import { createAdminClient } from "@/lib/supabase/admin";
import { publicKeyGate, publicJson } from "@/lib/website-cms/public";
import type { WebsiteOfferRow } from "@/lib/website-cms/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = await publicKeyGate(req);
  if (denied) return denied;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("website_offers")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) return Response.json({ error: "Content unavailable" }, { status: 503 });
  const offers = ((data ?? []) as WebsiteOfferRow[]).map((o) => ({
    title: o.title,
    bannerText: o.banner_text,
    serviceSlug: o.service_slug,
    active: o.active,
  }));
  return publicJson({ offers });
}
