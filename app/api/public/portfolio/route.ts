import { createAdminClient } from "@/lib/supabase/admin";
import { publicKeyGate, publicJson } from "@/lib/website-cms/public";
import type { WebsitePortfolioRow } from "@/lib/website-cms/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = await publicKeyGate(req);
  if (denied) return denied;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("website_portfolio")
    .select("*")
    .eq("active", true)
    .order("featured", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return Response.json({ error: "Content unavailable" }, { status: 503 });
  const portfolio = ((data ?? []) as WebsitePortfolioRow[]).map((p) => ({
    clientName: p.client_name,
    industry: p.industry,
    state: p.state,
    liveUrl: p.live_url,
    featured: p.featured,
    ...(p.screenshot ? { screenshot: p.screenshot } : {}),
  }));
  return publicJson({ portfolio });
}
