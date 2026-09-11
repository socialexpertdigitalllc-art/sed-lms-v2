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

export type AddOn = { id: string; label: string; price: number | null };

/** The social networks a business is asked about, in the order they are offered. */
export const SOCIAL_PLATFORMS = ["Facebook", "Instagram", "TikTok", "X", "Other"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/**
 * One social profile of the business. `label` names the network only when
 * `platform` is "Other", so the canonical five always round-trip back into the
 * select rather than becoming free text the form can no longer match.
 */
export type SocialProfile = { platform: string; url: string; label?: string | null };

/** A custom lead tag from the `lead_tags` catalog. Owned by a single user. */
export type LeadTag = { id: string; name: string; color: string; owner_id: string };

export interface Lead {
  id: string;
  status: string;
  agent_id: string | null;
  business_name: string;
  /**
   * The owner's own name, when the agent got it. Optional on every form, and
   * optional on the TYPE as well: a row read before migration 0073 is applied
   * carries no such key at all. Same for the two 0073 fields below.
   */
  owner_name?: string | null;
  business_phone: string | null;
  business_email: string | null;
  no_email: boolean | null;
  business_profile_link: string | null;
  website_link: string | null;
  logo_link: string | null;
  logo_via_sms: boolean | null;
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
  color_same_as_logo: boolean | null;
  add_ons: AddOn[] | null;
  price_quoted: number | null;
  yearly_price: string | null;
  follow_up_time: string | null;
  /** The scheduled follow_up_time is an exact time the client asked for. */
  follow_up_is_specific?: boolean | null;
  /** When that schedule was recorded — the clock the Specific badge decays on. */
  follow_up_set_at?: string | null;
  last_followup_status: string | null;
  no_pickup_streak: number;
  /** Set when the lead enters Closed; cleared if it leaves. Ledger: lead_status_events. */
  closed_at: string | null;
  /** Set when the lead enters Dropped; cleared if it leaves. */
  dropped_at: string | null;
  /** First follow-up ever logged on this lead. Set once. */
  first_touch_at: string | null;
  direct_line_saved: boolean | null;
  fresh_or_followup: string | null;
  reference_link: string | null;
  design_reference_links: string[] | null;
  image_links: string[] | null;
  rating: number | null;
  comments: string | null;
  /** Free-text background on the business, fed to the website generator's brief. */
  about_business: string | null;
  /** Anything the agent promised the client that the build has to honour. */
  developer_instructions?: string | null;
  social_profiles?: SocialProfile[] | null;
  /** Manual area (US state) override — wins over the phone-derived region. */
  custom_area?: string | null;
  /** Business category name from the shared lead_categories catalog. */
  category?: string | null;
  /** The template the agent selected with the client (builder_templates.id). */
  recommended_template_id?: string | null;
  created_by: string | null;
  closed_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** Populated client-side from `lead_tag_links` (not a column on `leads`). */
  tag_ids?: string[];
}
