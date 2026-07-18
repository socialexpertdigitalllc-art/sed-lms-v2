/**
 * Pure "is this lead ready to generate?" completeness check for the setup
 * dossier. Given the subset of lead fields the generator actually consumes,
 * report which key inputs are present vs missing so the operator can fill gaps
 * before starting a run. No I/O. UI-agnostic (SetupPanel renders the result).
 */

export type DossierInput = {
  logo_link: string | null;
  map_embed_link: string | null;
  color_scheme: string | null;
  color_same_as_logo: boolean | null;
  services: string[] | null;
  service_areas: string[] | null;
  business_phone: string | null;
  business_email: string | null;
  no_email: boolean | null;
  image_links: string[] | null;
};

export type DossierField = { key: string; label: string; present: boolean };

const has = (v: string | null | undefined): boolean =>
  typeof v === "string" && v.trim().length > 0;
const hasList = (v: string[] | null | undefined): boolean =>
  Array.isArray(v) && v.some((x) => typeof x === "string" && x.trim().length > 0);

/** The key dossier fields, in display order, each flagged present/missing. */
export function dossierFields(lead: DossierInput): DossierField[] {
  return [
    { key: "logo", label: "Logo", present: has(lead.logo_link) },
    { key: "map", label: "Map", present: has(lead.map_embed_link) },
    // "Match the logo" is a deliberate colour choice, so it counts as present.
    { key: "colors", label: "Colors", present: lead.color_same_as_logo === true || has(lead.color_scheme) },
    { key: "services", label: "Services", present: hasList(lead.services) },
    { key: "areas", label: "Areas", present: hasList(lead.service_areas) },
    { key: "phone", label: "Phone", present: has(lead.business_phone) },
    // no_email is an explicit "phone-CTAs only" decision — a resolved gap, not a hole.
    { key: "email", label: "Email", present: lead.no_email === true || has(lead.business_email) },
    { key: "photos", label: "Photos", present: hasList(lead.image_links) },
  ];
}

/** Completeness summary: the per-field flags plus a filled/total tally. */
export function dossierCompleteness(lead: DossierInput): {
  fields: DossierField[]; filled: number; total: number;
} {
  const fields = dossierFields(lead);
  return { fields, filled: fields.filter((f) => f.present).length, total: fields.length };
}
