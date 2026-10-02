import { createAdminClient } from "@/lib/supabase/admin";
import { ipRateAllowed } from "@/lib/forms/gate";
import { judgeCoupon } from "./public";
import { websiteLeadIntakeSchema } from "./schema";
import type { WebsiteCouponRow } from "./types";

// Lead intake for the agency's own website. Everything lands in
// website_leads (Website → Leads), never in the client-facing Form Relay.
// Spam is recorded with a reason, not dropped, so a false positive can be
// recovered; IP floods are refused outright so they can't fill the table.

const MIN_FILL_MS = 2000;

export type IntakeResult =
  | { ok: true; id: string | null; spam: boolean }
  | { ok: false; status: 422 | 429 | 503; error: string; fieldErrors?: Record<string, string[]> };

export async function intakeWebsiteLead(body: unknown, fallbackIp: string): Promise<IntakeResult> {
  const parsed = websiteLeadIntakeSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>;
    const first = Object.values(fieldErrors).flat()[0] ?? "Please check the form and try again.";
    return { ok: false, status: 422, error: first, fieldErrors };
  }
  const input = parsed.data;

  // The website's server relays the visitor's IP; without it every visitor
  // would share the website server's address and one bucket.
  const ip = input.ip ?? fallbackIp;
  if (!ipRateAllowed(`website-lead:${ip}`)) {
    return { ok: false, status: 429, error: "Too many requests. Please wait a minute and try again." };
  }

  const spamReason =
    input.company_website && input.company_website.trim().length > 0
      ? "honeypot"
      : typeof input.elapsed_ms === "number" && input.elapsed_ms < MIN_FILL_MS
        ? "too_fast"
        : null;

  const admin = createAdminClient();

  let couponValid: boolean | null = null;
  if (input.coupon) {
    const { data } = await admin
      .from("website_coupons")
      .select("*")
      .eq("code", input.coupon.toUpperCase())
      .maybeSingle();
    couponValid = judgeCoupon((data as WebsiteCouponRow | null) ?? null, input.service_slug).valid;
  }

  const submittedAt =
    input.submitted_at && !Number.isNaN(Date.parse(input.submitted_at))
      ? new Date(input.submitted_at).toISOString()
      : new Date().toISOString();

  const { data: inserted, error } = await admin
    .from("website_leads")
    .insert({
      name: input.name,
      email: input.email,
      phone: input.phone,
      message: input.message,
      service_slug: input.service_slug,
      tier_name: input.tier_name,
      coupon: input.coupon ? input.coupon.toUpperCase() : null,
      coupon_valid: couponValid,
      source_page: input.source_page,
      referrer: input.referrer,
      utm_source: input.utm_source,
      utm_medium: input.utm_medium,
      utm_campaign: input.utm_campaign,
      utm_term: input.utm_term,
      utm_content: input.utm_content,
      ip,
      user_agent: input.user_agent,
      is_spam: spamReason !== null,
      spam_reason: spamReason,
      submitted_at: submittedAt,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    return { ok: false, status: 503, error: "We couldn't save your request right now." };
  }

  return { ok: true, id: inserted.id as string, spam: spamReason !== null };
}
