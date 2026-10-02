import { createAdminClient } from "@/lib/supabase/admin";
import { publicKeyGate, publicJson } from "@/lib/website-cms/public";
import type { WebsiteTestimonialRow } from "@/lib/website-cms/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = await publicKeyGate(req);
  if (denied) return denied;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("website_testimonials")
    .select("*")
    .eq("approved", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return Response.json({ error: "Content unavailable" }, { status: 503 });
  const testimonials = ((data ?? []) as WebsiteTestimonialRow[]).map((t) => ({
    clientName: t.client_name,
    business: t.business,
    quote: t.quote,
    rating: t.rating,
  }));
  return publicJson({ testimonials });
}
