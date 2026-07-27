/** Everything a generated website may know about the client. Built ONCE from a
 *  lead row by `buildDossier` — nothing downstream reads the lead again.
 *  `buildDossier` constructs a fresh object naming only the allowed keys, so
 *  commercial and internal fields (price_quoted, yearly_price, rating,
 *  comments, platform) never appear in a value it returns. That guarantee
 *  holds only through `buildDossier` itself: `Dossier` is a structural
 *  interface, so a cast like `{...lead} as Dossier` would defeat it. Callers
 *  must never cast a raw lead into a `Dossier` — always go through
 *  `buildDossier`, the ONE place lead columns are read. */
export interface Dossier {
  lead_id: string;
  business_name: string;
  phone?: string;
  phone_href?: string;
  email?: string;
  /** `mailto:` form, derived whenever `email` is present. The compiler
   *  tokenizes a template's mailto links as {{id:email_href}}, so this must be
   *  supplied as a matched pair with `email` exactly like phone/phone_href —
   *  omitting it made every render refuse. */
  email_href?: string;
  /** True only when the lead explicitly says the business has no email. An
   *  absent email is "not captured yet", which is a different thing. */
  no_email: boolean;
  profile_link?: string;
  /** An embeddable `src` for the client's Google Business Profile — present
   *  only when `business_profile_link` is recognizably a Google URL (see
   *  `isGoogleProfileUrl`). Distinct from `map_embed`: the locked operator
   *  decision (Phase 4c, Task 6) is that the map iframe keeps using
   *  `map_embed_link`, and a Google profile embeds SEPARATELY — never as a
   *  substitute for the map, never folded into it. */
  profile_embed?: string;
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

// Extension markers: "ext", "ext.", "extension" as whole words; a lone "x"
// either as its own word ("x 2") or immediately glued to digits ("x99"); or
// "#". Anything from the marker onward is dropped before deriving the dial
// string — it is never part of a number a `tel:` link should include.
const EXTENSION_RE = /\b(ext\.?|extension|x)\b|\bx(?=\d)|#/i;

/**
 * True for a URL that is recognizably a Google Business Profile / Maps
 * listing — a Maps place URL, a `g.page`/`goo.gl/maps`/`maps.app.goo.gl`
 * short link, a `business.google.com` dashboard URL, or a `maps.google.com`
 * link (e.g. a `?cid=` permalink). Deliberately narrow: a generic
 * `google.com` URL that ISN'T under `/maps` (a Doc, a Form, a Drive link)
 * does not count — those are not embeddable business listings. Fails safe
 * (false) for anything that doesn't parse as an absolute http(s) URL.
 */
function isGoogleProfileUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "g.page" || host === "maps.app.goo.gl" || host === "business.google.com" || host === "maps.google.com") return true;
  if (host === "goo.gl" && u.pathname.startsWith("/maps")) return true;
  if ((host === "google.com" || host === "www.google.com") && u.pathname.startsWith("/maps")) return true;
  return false;
}

function isDialable(digits: string): boolean {
  if (digits.startsWith("+")) return digits.length - 1 >= 8; // international
  return digits.length === 10 || (digits.length === 11 && digits[0] === "1");
}

/** Builds a `tel:` href from a free-text phone number, WITHOUT ever guessing
 *  past what the digits actually support. `display` is always the full
 *  original text (an extension like "ext 2" still shows to the reader).
 *  `href` is derived only from the portion before any extension marker, and
 *  is null when what's left doesn't look like a real, dialable number —
 *  otherwise a placeholder like "555-1234" or "TBD 000-0000" would render as
 *  a confident, wrong click-to-call link on a live client site. */
export function normalisePhone(raw: unknown): { display: string; href: string | null } | null {
  const display = str(raw);
  if (!display) return null;
  const cut = display.search(EXTENSION_RE);
  const trunk = cut >= 0 ? display.slice(0, cut) : display;
  const digits = trunk.replace(/[^\d+]/g, "");
  return { display, href: isDialable(digits) ? `tel:${digits}` : null };
}

/** Shape-loose on purpose: the caller passes a raw lead row. */
export function buildDossier(lead: Record<string, unknown>): Dossier {
  const phone = normalisePhone(lead.business_phone);
  const addOns = Array.isArray(lead.add_ons)
    ? (lead.add_ons as { label?: unknown }[]).map((a) => String(a?.label ?? "").trim()).filter(Boolean)
    : [];
  const profileLink = str(lead.business_profile_link);
  return {
    lead_id: String(lead.id),
    business_name: String(lead.business_name ?? "").trim(),
    phone: phone?.display,
    phone_href: phone?.href ?? undefined,
    email: str(lead.business_email),
    email_href: str(lead.business_email) ? `mailto:${str(lead.business_email)}` : undefined,
    no_email: lead.no_email === true,
    profile_link: profileLink,
    profile_embed: profileLink && isGoogleProfileUrl(profileLink) ? profileLink : undefined,
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
