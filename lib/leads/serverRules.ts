import { PHONE_RE } from "@/lib/forms/phone";
import { MAX_COLORS, MIN_COLORS, parseColorScheme } from "@/lib/leads/colorScheme";

/**
 * The New Lead form's rules, enforced on the SERVER — on the payload POST
 * /api/leads receives (the shape buildLeadPayload produces), so nothing that
 * skips the form can create a half-filled lead: not a script, not a stale
 * browser tab, not SED AI.
 *
 * Mirrors validateNewLead (lib/leads/newLeadForm.ts) rule for rule; the form
 * keeps its own copy for instant, field-by-field feedback. A lead the form
 * accepts is always accepted here — the one deliberate difference is a few
 * minutes' grace on "follow-up time in the future", for the time between
 * pressing Submit and the request arriving.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/.+/;
const FOLLOW_UP_GRACE_MS = 5 * 60 * 1000;

type Payload = Record<string, unknown>;

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown) => (Array.isArray(v) ? v.filter((s) => typeof s === "string" && s.trim()) : []);

/** Field → message for everything a new lead is missing or has wrong. Empty = acceptable. */
export function leadPayloadErrors(p: Payload, now: Date = new Date()): Record<string, string> {
  const e: Record<string, string> = {};
  if (!text(p.status)) e.status = "A status is required.";
  if (!text(p.site_type)) e.site_type = "Select a site type.";
  if (!text(p.business_name)) e.business_name = "Business name is required.";
  if (!PHONE_RE.test(text(p.business_phone))) e.business_phone = "Enter a valid phone: (252) 401-2775";
  if (p.no_email !== true && !EMAIL_RE.test(text(p.business_email))) e.business_email = "Enter a valid email address (or mark the lead as having no email).";
  if (!text(p.platform)) e.platform = "Select a platform.";
  if (!text(p.business_profile_link)) e.business_profile_link = "Profile link is required.";
  if (typeof p.has_service_areas !== "boolean") e.has_service_areas = "Say whether the business has service areas.";
  if (p.has_service_areas === true && list(p.service_areas).length === 0) e.service_areas = "At least one service area is required.";
  if (list(p.services).length === 0) e.services = "At least one service is required.";

  const exp = typeof p.client_experience === "number" ? p.client_experience : Number.NaN;
  if (!Number.isInteger(exp) || exp < 0) e.client_experience = "Enter the client's years of experience.";
  const pages = typeof p.num_webpages === "number" ? p.num_webpages : 0;
  if (pages < 1 || list(p.specify_pages).length === 0) e.specify_pages = "Select at least one page.";

  const scheme = text(p.color_scheme);
  const colors = parseColorScheme(scheme).length;
  if (!scheme) e.color_scheme = "Color scheme is required.";
  else if (colors < MIN_COLORS) e.color_scheme = `Enter at least ${MIN_COLORS} colours.`;
  else if (colors > MAX_COLORS) e.color_scheme = `Enter at most ${MAX_COLORS} colours.`;

  if (list(p.design_reference_links).some((u) => !URL_RE.test(String(u).trim()))) e.design_reference_links = "Enter valid URLs.";

  const fu = Date.parse(text(p.follow_up_time));
  if (!Number.isFinite(fu) || fu <= now.getTime() - FOLLOW_UP_GRACE_MS) e.follow_up_time = "Follow up time must be in the future.";
  if (typeof p.price_quoted !== "number" || !Number.isFinite(p.price_quoted) || p.price_quoted < 0) e.price_quoted = "Enter the price quoted.";
  const ref = text(p.reference_link);
  if (p.site_type === "Redesign" && ref && !URL_RE.test(ref)) e.reference_link = "Enter a valid reference site URL.";
  if (!text(p.comments)) e.comments = "Enter comments about the client.";
  const rating = typeof p.rating === "number" ? p.rating : 0;
  if (!Number.isInteger(rating) || rating < 1 || rating > 10) e.rating = "Rate the lead from 1 to 10.";
  if (!text(p.fresh_or_followup)) e.fresh_or_followup = "Select Fresh or Follow Up.";
  if (!text(p.closed_by)) e.closed_by = "Select who closed the lead.";
  return e;
}

/** The first few problems as one sentence, for an API error. */
export function leadPayloadMessage(errors: Record<string, string>): string {
  const msgs = Object.values(errors);
  if (!msgs.length) return "";
  return msgs.length === 1 ? msgs[0] : `${msgs.slice(0, 3).join(" ")}${msgs.length > 3 ? ` (and ${msgs.length - 3} more)` : ""}`;
}
