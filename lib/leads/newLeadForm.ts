import { PHONE_RE } from "@/lib/forms/phone";

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
  image_links: string[];
  follow_up_time: string;
  price_quoted: string;
  price_custom: string;
  yearly_price: string;
  yearly_custom: string;
  direct_line_saved: "" | "Yes" | "No";
  reference_link: string;
  comments: string;
  rating: number;
  fresh_or_followup: string;
}

export function emptyNewLead(status: string): NewLeadFormState {
  return {
    status,
    agent_id: "",
    site_type: "",
    business_name: "",
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
    image_links: [""],
    follow_up_time: "",
    price_quoted: "",
    price_custom: "",
    yearly_price: "",
    yearly_custom: "",
    direct_line_saved: "",
    reference_link: "",
    comments: "",
    rating: 0,
    fresh_or_followup: "",
  };
}

export function nonEmpty(list: string[]): string[] {
  return list.map((s) => s.trim()).filter(Boolean);
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
  if (!EMAIL_RE.test(f.business_email.trim())) e.business_email = "Enter a valid email address.";
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

  if (!f.color_scheme.trim()) e.color_scheme = "Color scheme is required.";
  if (!f.follow_up_time || new Date(f.follow_up_time) <= now)
    e.follow_up_time = "Follow up time must be in the future.";
  if (!f.price_quoted) e.price_quoted = "Please select a price.";
  if (f.price_quoted === "Other" && (f.price_custom === "" || Number(f.price_custom) < 0))
    e.price_custom = "Enter a valid custom price.";
  if (f.site_type === "Redesign" && !/^https?:\/\/.+/.test(f.reference_link.trim()))
    e.reference_link = "A valid reference site URL is required for redesigns.";
  if (!f.comments.trim()) e.comments = "Please enter comments about the client.";
  if (f.rating === 0) e.rating = "Please rate the lead.";
  if (!f.fresh_or_followup) e.fresh_or_followup = "Please select Fresh or Follow Up.";

  return e;
}

/** Map the form state to the POST /api/leads body (createLeadSchema shape). */
export function buildLeadPayload(f: NewLeadFormState) {
  const services = nonEmpty(f.services);
  const areas = f.has_service_areas === "Yes" ? nonEmpty(f.areas) : [];
  const pages = f.specify_pages.map((p) => (p === "Other" ? f.other_page.trim() || "Other" : p));
  const total = pageTotal(f.specify_pages, services.length, areas.length);
  const images = nonEmpty(f.image_links);

  return {
    business_name: f.business_name.trim(),
    status: f.status,
    agent_id: f.agent_id || null,
    site_type: f.site_type || null,
    business_phone: f.business_phone.trim() || null,
    business_email: f.business_email.trim() || null,
    business_profile_link: f.business_profile_link.trim() || null,
    platform: f.platform === "Other" ? f.other_platform.trim() || null : f.platform || null,
    map_embed_link: f.map_embed_link.trim() || null,
    has_service_areas: f.has_service_areas === "" ? null : f.has_service_areas === "Yes",
    service_areas: areas.length ? areas : null,
    services: services.length ? services : null,
    client_experience: f.client_experience === "" ? null : parseInt(f.client_experience, 10),
    num_webpages: total || null,
    specify_pages: pages.length ? pages : null,
    color_scheme: f.color_scheme.trim() || null,
    logo_link: f.logo_link.trim() || null,
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
    comments: f.comments.trim() || null,
  };
}
