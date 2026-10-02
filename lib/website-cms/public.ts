import { createAdminClient } from "@/lib/supabase/admin";
import { getWebsiteSettings } from "./settings";
import {
  toPublicService,
  toPublicServiceDetail,
  type PublicService,
  type PublicServiceDetail,
  type WebsiteCouponRow,
  type WebsiteServiceRow,
} from "./types";

// The public, read-only content API for socialexpertdigitalllc.com.
// Server-to-server only (the website fetches during render), so no CORS.
// Gated by the publishable key in website_settings.api_key; while that is
// empty (bootstrap) reads are open — everything served here is public
// site content anyway.

export async function publicKeyGate(req: Request): Promise<Response | null> {
  const settings = await getWebsiteSettings();
  if (!settings.api_key) return null;
  if (req.headers.get("x-sed-key") === settings.api_key) return null;
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

const CACHE_HEADERS = { "Cache-Control": "no-store" } as const;

export function publicJson(payload: unknown): Response {
  // The website caches via ISR on its side; serving no-store here keeps the
  // dashboard the single cache authority.
  return Response.json(payload, { headers: CACHE_HEADERS });
}

export async function loadSiteContent(): Promise<{
  services: PublicService[];
  serviceDetails: Record<string, PublicServiceDetail>;
}> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("website_services")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as WebsiteServiceRow[];
  const serviceDetails: Record<string, PublicServiceDetail> = {};
  for (const row of rows) serviceDetails[row.slug] = toPublicServiceDetail(row);
  return { services: rows.map(toPublicService), serviceDetails };
}

export type CouponVerdict =
  | { valid: true; code: string; label: string; discountType: "percent" | "fixed"; amount: number }
  | { valid: false; error: string };

export function judgeCoupon(row: WebsiteCouponRow | null, service: string | null): CouponVerdict {
  if (!row || !row.active) return { valid: false, error: "That code isn't valid." };
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return { valid: false, error: "That code has expired." };
  }
  if (row.service_slugs.length > 0 && (!service || !row.service_slugs.includes(service))) {
    return { valid: false, error: "That code doesn't apply to this service." };
  }
  const label =
    row.label ||
    (row.discount_type === "percent" ? `${row.amount}% off` : `$${row.amount} off`);
  return { valid: true, code: row.code, label, discountType: row.discount_type, amount: row.amount };
}
