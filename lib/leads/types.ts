export const LEAD_STATUSES = ["Ready", "Not Ready", "Closed", "Dropped", "Long Term"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const SITE_TYPES = [
  "Custom Website",
  "Redesign",
  "E-Commerce",
  "Landing Page",
] as const;
export type SiteType = (typeof SITE_TYPES)[number];

export const FRESH_OPTIONS = ["Fresh", "Follow Up"] as const;

/** Tailwind classes for each status pill (soft bg + fg). */
export const STATUS_PILL: Record<string, string> = {
  Ready: "bg-ready-bg text-ready-fg",
  "Not Ready": "bg-notready-bg text-notready-fg",
  Closed: "bg-closed-bg text-closed-fg",
  Dropped: "bg-dropped-bg text-dropped-fg",
  "Long Term": "bg-longterm-bg text-longterm-fg",
};

export interface Lead {
  id: string;
  status: string;
  agent_id: string | null;
  business_name: string;
  business_phone: string | null;
  business_email: string | null;
  business_profile_link: string | null;
  website_link: string | null;
  logo_link: string | null;
  map_embed_link: string | null;
  site_type: string | null;
  platform: string | null;
  services: string[] | null;
  service_areas: string[] | null;
  has_service_areas: boolean | null;
  client_experience: number | null;
  num_webpages: number | null;
  specify_pages: string[] | null;
  color_scheme: string | null;
  price_quoted: number | null;
  yearly_price: string | null;
  follow_up_time: string | null;
  direct_line_saved: boolean | null;
  fresh_or_followup: string | null;
  reference_link: string | null;
  image_links: string[] | null;
  rating: number | null;
  comments: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
