import type { Lead } from "./types";

/**
 * Plain-text "Label: value" block of a lead's business details, for the table's
 * "copy all business details" button. Empty/null fields are skipped entirely.
 * Array fields join with ", " except image links, which go one per line under
 * their label.
 */
export function leadCopyText(lead: Lead): string {
  const lines: string[] = [];
  const add = (label: string, value: string | number | null | undefined) => {
    const s = value == null ? "" : String(value).trim();
    if (s) lines.push(`${label}: ${s}`);
  };

  add("Business Name", lead.business_name);
  add("Phone", lead.business_phone);
  add("Email", lead.business_email);
  add("Profile Link", lead.business_profile_link);
  add("Logo Link", lead.logo_link);
  add("Map Embed Link", lead.map_embed_link);
  add("Services", (lead.services ?? []).filter((s) => s.trim()).join(", "));
  add("Service Areas", (lead.service_areas ?? []).filter((s) => s.trim()).join(", "));
  add("Specify Pages", (lead.specify_pages ?? []).filter((s) => s.trim()).join(", "));
  add("Color Scheme", lead.color_scheme);
  add("Client Experience (years)", lead.client_experience);

  const images = (lead.image_links ?? []).map((s) => s.trim()).filter(Boolean);
  if (images.length) lines.push("Image Links:", ...images);

  return lines.join("\n");
}
