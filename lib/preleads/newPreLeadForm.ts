import { PHONE_RE } from "@/lib/forms/phone";

export interface PreLeadFormState {
  service_offered: string;
  service_type: string;
  business_name: string;
  phone_number: string;
  email: string;
  owner_name: string;
  google_yelp_link: string;
  areas: string;
  services: string;
  pricing: string;
  follow_up_time: string;
  lead_category: string;
  comments: string;
}

export function emptyPreLead(): PreLeadFormState {
  return {
    service_offered: "",
    service_type: "",
    business_name: "",
    phone_number: "",
    email: "",
    owner_name: "",
    google_yelp_link: "",
    areas: "",
    services: "",
    pricing: "",
    follow_up_time: "",
    lead_category: "",
    comments: "",
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validatePreLead(f: PreLeadFormState, now: Date = new Date()): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.service_offered) e.service_offered = "Please select a service.";
  if (f.service_offered === "Website" && !f.service_type)
    e.service_type = "Service type is required for Website.";
  if (!f.business_name.trim()) e.business_name = "Business name is required.";
  if (!PHONE_RE.test(f.phone_number.trim())) e.phone_number = "Use format: (252) 401-2775";
  if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) e.email = "Enter a valid email address.";
  if (!f.google_yelp_link.trim()) e.google_yelp_link = "Profile link is required.";
  const t = f.follow_up_time ? new Date(f.follow_up_time).getTime() : NaN;
  if (!f.follow_up_time) e.follow_up_time = "Follow-up date & time is required.";
  else if (Number.isNaN(t) || t <= now.getTime())
    e.follow_up_time = "Follow-up date & time must be in the future.";
  if (!f.lead_category) e.lead_category = "Please select a category.";
  return e;
}

const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function buildPreLeadPayload(f: PreLeadFormState) {
  const d = f.follow_up_time ? new Date(f.follow_up_time) : null;
  return {
    business_name: f.business_name.trim(),
    lead_category: f.lead_category,
    status: "Next follow up",
    service_offered: f.service_offered || null,
    service_type: f.service_type || null,
    phone_number: f.phone_number.trim() || null,
    email: f.email.trim() || null,
    owner_name: f.owner_name.trim() || null,
    google_yelp_link: f.google_yelp_link.trim() || null,
    pricing: f.pricing.trim() === "" ? null : Number(f.pricing),
    areas: csv(f.areas),
    services: csv(f.services),
    follow_up_time: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null,
    comments: f.comments.trim() || null,
  };
}
