import { PHONE_RE } from "@/lib/forms/phone";
import { MAX_COLORS, MIN_COLORS, parseColorScheme } from "@/lib/leads/colorScheme";
import type { AddOn, SocialProfile } from "@/lib/leads/types";

export const PAGE_OPTIONS = [
  "Home",
  "About Us",
  "Services",
  "Service Areas",
  "Gallery",
  "Contact Us",
  "Individual Service Pages",
  "Individual Service Area Pages",
  "Pricing",
  "Other",
] as const;

export const PLATFORM_OPTIONS = ["Google", "Yelp", "Other"] as const;
export const PRICE_OPTIONS = ["250", "500", "750", "Other"] as const;
export const YEARLY_OPTIONS = ["100", "50", "Other", "None"] as const;

export interface NewLeadFormState {
  status: string;
  agent_id: string;
  site_type: string;
  business_name: string;
  /** The owner's own name. Optional — agents often only get the business. */
  owner_name: string;
  business_phone: string;
  business_email: string;
  platform: string;
  other_platform: string;
  business_profile_link: string;
  map_embed_link: string;
  has_service_areas: "" | "Yes" | "No";
  areas: string[];
  services: string[];
  client_experience: string;
  specify_pages: string[];
  other_page: string;
  color_scheme: string;
  logo_link: string;
  logo_via_sms: boolean;
  image_links: string[];
  design_reference_links: string[];
  add_ons: AddOn[];
  follow_up_time: string;
  price_quoted: string;
  price_custom: string;
  yearly_price: string;
  yearly_custom: string;
  direct_line_saved: "" | "Yes" | "No";
  reference_link: string;
  /** Optional free-text background on the business (feeds the website generator). */
  about_business: string;
  /** Optional instructions the build has to honour. */
  developer_instructions: string;
  /** As many of the business's social profiles as it has. */
  social_profiles: SocialProfile[];
  /** builder_templates.id the agent picked with the client. Optional. */
  recommended_template_id: string;
  comments: string;
  rating: number;
  fresh_or_followup: string;
  no_email: boolean;
  /** Holds "self" (resolved to the current user at submit time) or a uuid. */
  closed_by: string;
}

export function emptyNewLead(status: string): NewLeadFormState {
  return {
    status,
    agent_id: "",
    site_type: "",
    business_name: "",
    owner_name: "",
    business_phone: "",
    business_email: "",
    platform: "",
    other_platform: "",
    business_profile_link: "",
    map_embed_link: "",
    has_service_areas: "",
    areas: [],
    services: [""],
    client_experience: "",
    specify_pages: ["Home"],
    other_page: "",
    color_scheme: "",
    logo_link: "",
    logo_via_sms: false,
    image_links: [""],
    design_reference_links: [],
    add_ons: [],
    follow_up_time: "",
    price_quoted: "",
    price_custom: "",
    yearly_price: "",
    yearly_custom: "",
    direct_line_saved: "",
    reference_link: "",
    about_business: "",
    developer_instructions: "",
    social_profiles: [],
    recommended_template_id: "",
    comments: "",
    rating: 0,
    fresh_or_followup: "",
    no_email: false,
    closed_by: "self",
  };
}

export function nonEmpty(list: string[]): string[] {
  return list.map((s) => s.trim()).filter(Boolean);
}

/**
 * Drop the half-filled rows a repeater always leaves behind — a profile with
 * no URL is nothing, and an "Other" with no name is unidentifiable. The name
 * lands in `label` only for Other, so the canonical five keep matching the
 * select when the lead is edited later.
 */
export function cleanSocialProfiles(list: SocialProfile[]): SocialProfile[] {
  return list
    .map((p) => ({
      platform: p.platform.trim(),
      url: p.url.trim(),
      label: p.platform.trim() === "Other" ? (p.label ?? "").trim() || null : null,
    }))
    .filter((p) => p.platform && p.url && (p.platform !== "Other" || p.label));
}

/**
 * Weighted page count, exactly as the old upfront form:
 * "Individual Service Pages" counts as the number of services (min 1),
 * "Individual Service Area Pages" as the number of areas (0 allowed),
 * every other selected chip counts as 1.
 */
export function pageTotal(selected: string[], serviceCount: number, areaCount: number): number {
  let total = 0;
  for (const p of selected) {
    if (p === "Individual Service Pages") total += Math.max(serviceCount, 1);
    else if (p === "Individual Service Area Pages") total += areaCount;
    else total += 1;
  }
  return total;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Field-keyed error messages, mirroring the old form's validateForm(). */
export function validateNewLead(
  f: NewLeadFormState,
  now: Date = new Date()
): Record<string, string> {
  const e: Record<string, string> = {};

  if (!f.status) e.status = "No category available to you.";
  if (!f.site_type) e.site_type = "Please select a site type.";
  if (!f.business_name.trim()) e.business_name = "Business name is required.";
  if (!PHONE_RE.test(f.business_phone.trim()))
    e.business_phone = "Enter a valid phone: (252) 401-2775";
  if (!f.no_email && !EMAIL_RE.test(f.business_email.trim()))
    e.business_email = "Enter a valid email address.";
  if (!f.platform) e.platform = "Please select a platform.";
  if (!f.business_profile_link.trim()) e.business_profile_link = "Profile link is required.";
  if (f.platform === "Other" && !f.other_platform.trim())
    e.other_platform = "Platform name is required when selecting Other.";
  if (!f.has_service_areas) e.has_service_areas = "Please indicate if there are service areas.";
  if (f.has_service_areas === "Yes" && nonEmpty(f.areas).length === 0)
    e.areas = "At least one area is required.";
  if (nonEmpty(f.services).length === 0) e.services = "At least one service is required.";

  const exp = parseInt(f.client_experience, 10);
  if (f.client_experience === "" || Number.isNaN(exp) || exp < 0)
    e.client_experience = "Please enter a valid number of years.";

  const total = pageTotal(
    f.specify_pages,
    nonEmpty(f.services).length,
    f.has_service_areas === "Yes" ? nonEmpty(f.areas).length : 0
  );
  if (total < 1) e.specify_pages = "Select at least one page.";

  // "Same as Logo" is no longer offered: a website needs an explicit palette,
  // and a logo we may never receive is not one. The column still exists for
  // historical leads (see buildLeadPayload / brief.ts) — we just stop writing it.
  //
  // A palette needs at least a brand colour and something to pair with it: one
  // colour alone leaves every button, heading and accent on the site to the
  // generator's guess, which is how leads arrived with a single hex and a site
  // came back looking nothing like the client's brand.
  const colorCount = parseColorScheme(f.color_scheme).length;
  if (!f.color_scheme.trim()) e.color_scheme = "Color scheme is required.";
  else if (colorCount < MIN_COLORS) e.color_scheme = `Enter at least ${MIN_COLORS} colours.`;
  else if (colorCount > MAX_COLORS) e.color_scheme = `Enter at most ${MAX_COLORS} colours.`;

  for (const u of f.design_reference_links) {
    const t = u.trim();
    if (t && !/^https?:\/\/.+/.test(t)) e.design_reference_links = "Enter valid URLs.";
  }

  const t = new Date(f.follow_up_time).getTime();
  if (!f.follow_up_time || Number.isNaN(t) || t <= now.getTime())
    e.follow_up_time = "Follow up time must be in the future.";
  if (!f.price_quoted) e.price_quoted = "Please select a price.";
  const price = Number(f.price_custom);
  if (
    f.price_quoted === "Other" &&
    (f.price_custom.trim() === "" || Number.isNaN(price) || price < 0)
  )
    e.price_custom = "Enter a valid custom price.";
  // Optional even for redesigns — only the FORMAT is checked when filled.
  const ref = f.reference_link.trim();
  if (f.site_type === "Redesign" && ref && !/^https?:\/\/.+/.test(ref))
    e.reference_link = "Enter a valid reference site URL.";
  // The template is optional: when the agent leaves it blank, the build
  // picks one from the brief.
  if (!f.comments.trim()) e.comments = "Please enter comments about the client.";
  if (f.rating === 0) e.rating = "Please rate the lead.";
  if (!f.fresh_or_followup) e.fresh_or_followup = "Please select Fresh or Follow Up.";
  if (!f.closed_by) e.closed_by = "Select who closed the lead.";

  return e;
}

/** Map the form state to the POST /api/leads body (createLeadSchema shape). */
export function buildLeadPayload(f: NewLeadFormState, opts?: { userId?: string }) {
  const services = nonEmpty(f.services);
  const areas = f.has_service_areas === "Yes" ? nonEmpty(f.areas) : [];
  const pages = f.specify_pages.map((p) => (p === "Other" ? f.other_page.trim() || "Other" : p));
  const total = pageTotal(f.specify_pages, services.length, areas.length);
  const images = nonEmpty(f.image_links);
  const designRefs = nonEmpty(f.design_reference_links);

  const socials = cleanSocialProfiles(f.social_profiles);

  return {
    business_name: f.business_name.trim(),
    owner_name: f.owner_name.trim() || null,
    status: f.status,
    agent_id: f.agent_id || null,
    site_type: f.site_type || null,
    business_phone: f.business_phone.trim() || null,
    no_email: f.no_email,
    business_email: f.no_email ? null : f.business_email.trim() || null,
    business_profile_link: f.business_profile_link.trim() || null,
    platform: f.platform === "Other" ? f.other_platform.trim() || null : f.platform || null,
    map_embed_link: f.map_embed_link.trim() || null,
    has_service_areas: f.has_service_areas === "" ? null : f.has_service_areas === "Yes",
    service_areas: areas.length ? areas : null,
    services: services.length ? services : null,
    client_experience: f.client_experience === "" ? null : parseInt(f.client_experience, 10),
    num_webpages: total || null,
    specify_pages: pages.length ? pages : null,
    // Always explicit now — new leads never claim "same as logo".
    color_same_as_logo: false,
    color_scheme: f.color_scheme.trim() || null,
    logo_via_sms: f.logo_via_sms,
    logo_link: f.logo_via_sms ? null : f.logo_link.trim() || null,
    design_reference_links: designRefs.length ? designRefs : null,
    add_ons: f.add_ons.length ? f.add_ons : null,
    image_links: images.length ? images : null,
    follow_up_time: f.follow_up_time ? new Date(f.follow_up_time).toISOString() : null,
    price_quoted:
      f.price_quoted === ""
        ? null
        : f.price_quoted === "Other"
          ? Number(f.price_custom)
          : Number(f.price_quoted),
    yearly_price:
      f.yearly_price === ""
        ? "None"
        : f.yearly_price === "Other"
          ? f.yearly_custom.trim() || "None"
          : f.yearly_price,
    direct_line_saved: f.direct_line_saved === "" ? null : f.direct_line_saved === "Yes",
    reference_link: f.site_type === "Redesign" ? f.reference_link.trim() || null : null,
    rating: f.rating || null,
    fresh_or_followup: f.fresh_or_followup || null,
    about_business: f.about_business.trim() || null,
    developer_instructions: f.developer_instructions.trim() || null,
    recommended_template_id: f.recommended_template_id || null,
    social_profiles: socials.length ? socials : null,
    comments: f.comments.trim() || null,
    closed_by: f.closed_by === "self" ? (opts?.userId ?? null) : f.closed_by || null,
  };
}
