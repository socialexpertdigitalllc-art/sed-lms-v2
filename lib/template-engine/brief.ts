import type { Lead } from "@/lib/leads/types";

export interface GenerationBrief {
  business_name: string;
  phone?: string;
  email?: string;
  /**
   * True when the business deliberately has no email address. The template's
   * `mailto:` links, email fields and "email us" CTAs must then be rewritten to
   * phone CTAs or removed. An absent `email` does NOT communicate this — it is
   * indistinguishable from "not captured yet" — so only this flag carries it.
   */
  no_email: boolean;
  site_type?: string;
  services: string[];
  service_areas: string[];
  years_experience?: number;
  notes?: string;             // lead.comments — the sales team's real context
  color_scheme?: string;
  logo_link?: string;
  client_photos: string[];    // lead.image_links — real photos of THIS business
  /**
   * lead.design_reference_links — sites the client pointed at for visual taste.
   * This cannot drive layout (the template's CSS is fixed and never
   * regenerated); it informs the image briefs — what the stock photos should
   * look and feel like.
   */
  design_references: string[];
  rating?: number;
  add_ons: string[];
  page_count?: number;
  requested_pages: string[];
  profile_link?: string;
  map_embed?: string;
  reference_link?: string;
}

const str = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : undefined;
};
const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];

/**
 * Everything the sales team captured — v1 sent only 6 of these fields.
 *
 * Deliberately excluded, and NOT oversights: `price_quoted` / `yearly_price`
 * are our deal pricing and must never reach a public client site; `platform`
 * (lead source) and `logo_via_sms` (a delivery mechanic) are internal; and
 * `has_service_areas` is already implied by the `service_areas` array.
 */
export function buildBrief(lead: Lead): GenerationBrief {
  const sameAsLogo = lead.color_same_as_logo === true;
  return {
    business_name: str(lead.business_name) ?? "",
    phone: str(lead.business_phone),
    email: str(lead.business_email),
    no_email: lead.no_email === true,
    site_type: str(lead.site_type),
    services: arr(lead.services),
    service_areas: arr(lead.service_areas),
    years_experience:
      typeof lead.client_experience === "number" ? lead.client_experience : undefined,
    notes: str(lead.comments),
    color_scheme: sameAsLogo ? "match the logo" : str(lead.color_scheme),
    logo_link: str(lead.logo_link),
    client_photos: arr(lead.image_links),
    design_references: arr(lead.design_reference_links),
    rating: typeof lead.rating === "number" ? lead.rating : undefined,
    add_ons: Array.isArray(lead.add_ons)
      ? lead.add_ons.map((a) => String(a?.label ?? "").trim()).filter(Boolean)
      : [],
    page_count: typeof lead.num_webpages === "number" ? lead.num_webpages : undefined,
    requested_pages: arr(lead.specify_pages),
    profile_link: str(lead.business_profile_link),
    map_embed: str(lead.map_embed_link),
    reference_link: str(lead.reference_link),
  };
}
