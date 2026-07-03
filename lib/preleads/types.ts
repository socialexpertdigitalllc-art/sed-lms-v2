export const LEAD_CATEGORIES = [
  "Strong Lead",
  "Weak Lead",
  "Mockup",
  "Long Term",
  "Upfront",
  "Call Backs",
] as const;
export type LeadCategory = (typeof LEAD_CATEGORIES)[number];

export const PRELEAD_STATUSES = ["Next follow up", "Closed", "Dropped"] as const;
export type PreLeadStatus = (typeof PRELEAD_STATUSES)[number];

export const SERVICE_OFFERED = ["SEO", "Website"] as const;
export const SERVICE_TYPE = ["Redesign", "Fresh"] as const;
export const FOLLOWUP_REASONS = ["No Pickup", "Rescheduled"] as const;

/** Tailwind classes for each category pill (soft bg + fg). */
export const CATEGORY_PILL: Record<string, string> = {
  "Strong Lead": "bg-ready-bg text-ready-fg",
  "Weak Lead": "bg-notready-bg text-notready-fg",
  Mockup: "bg-longterm-bg text-longterm-fg",
  "Long Term": "bg-closed-bg text-closed-fg",
  Upfront: "bg-accent-soft text-accent-ink",
  "Call Backs": "bg-surface-2 text-text-muted",
};

export const PRELEAD_STATUS_PILL: Record<string, string> = {
  "Next follow up": "bg-longterm-bg text-longterm-fg",
  Closed: "bg-ready-bg text-ready-fg",
  Dropped: "bg-dropped-bg text-dropped-fg",
};

export interface PreLead {
  id: string;
  agent_id: string | null;
  business_name: string;
  phone_number: string | null;
  email: string | null;
  owner_name: string | null;
  google_yelp_link: string | null;
  areas: string[] | null;
  services: string[] | null;
  service_offered: string | null;
  service_type: string | null;
  pricing: number | null;
  lead_category: string;
  status: string;
  follow_up_time: string | null;
  comments: string | null;
  created_at: string;
  updated_at: string;
  last_updated_by: string | null;
  deleted_at: string | null;
}
