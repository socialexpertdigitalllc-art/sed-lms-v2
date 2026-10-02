import { createAdminClient } from "@/lib/supabase/admin";
import { publicKeyGate, judgeCoupon } from "@/lib/website-cms/public";
import type { WebsiteCouponRow } from "@/lib/website-cms/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const denied = await publicKeyGate(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { code?: unknown; service?: unknown };
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const service = typeof body.service === "string" && body.service ? body.service : null;
  if (!code || code.length > 64) {
    return Response.json({ valid: false, error: "Enter a coupon code." }, { status: 422 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("website_coupons")
    .select("*")
    .eq("code", code)
    .maybeSingle();
  if (error) return Response.json({ valid: false, error: "Could not check that code." }, { status: 503 });

  return Response.json(judgeCoupon((data as WebsiteCouponRow | null) ?? null, service), {
    headers: { "Cache-Control": "no-store" },
  });
}
