/** Everything a generated website may know about the client. Built ONCE from a
 *  lead row; nothing downstream reads the lead again. Commercial and internal
 *  fields (price_quoted, yearly_price, rating, comments, platform) are absent
 *  BY CONSTRUCTION — they must never reach a public page. */
export interface Dossier {
  lead_id: string;
  business_name: string;
  phone?: string;
  phone_href?: string;
  email?: string;
  /** True only when the lead explicitly says the business has no email. An
   *  absent email is "not captured yet", which is a different thing. */
  no_email: boolean;
  profile_link?: string;
  logo?: string;
  map_embed?: string;
  site_type?: string;
  services: string[];
  service_areas: string[];
  years_experience?: number;
  about_business?: string;
  color_scheme?: string;
  requested_pages: string[];
  design_references: string[];
  add_ons: string[];
  client_photos: string[];
}

const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : [];

const str = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s : undefined;
};

export function normalisePhone(raw: unknown): { display: string; href: string } | null {
  const display = str(raw);
  if (!display) return null;
  const digits = display.replace(/[^\d+]/g, "");
  return digits.length >= 7 ? { display, href: `tel:${digits}` } : null;
}

/** Shape-loose on purpose: the caller passes a raw lead row. */
export function buildDossier(lead: Record<string, unknown>): Dossier {
  const phone = normalisePhone(lead.business_phone);
  const addOns = Array.isArray(lead.add_ons)
    ? (lead.add_ons as { label?: unknown }[]).map((a) => String(a?.label ?? "").trim()).filter(Boolean)
    : [];
  return {
    lead_id: String(lead.id),
    business_name: String(lead.business_name ?? "").trim(),
    phone: phone?.display,
    phone_href: phone?.href,
    email: str(lead.business_email),
    no_email: lead.no_email === true,
    profile_link: str(lead.business_profile_link),
    logo: str(lead.logo_link),
    map_embed: str(lead.map_embed_link),
    site_type: str(lead.site_type),
    services: arr(lead.services),
    service_areas: arr(lead.service_areas),
    years_experience: typeof lead.client_experience === "number" ? lead.client_experience : undefined,
    about_business: str(lead.about_business),
    color_scheme: str(lead.color_scheme),
    requested_pages: arr(lead.specify_pages),
    design_references: arr(lead.design_reference_links),
    add_ons: addOns,
    client_photos: arr(lead.image_links),
  };
}
