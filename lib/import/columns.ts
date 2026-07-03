// Spreadsheet column letter (A, B, …, Z, AA, AB) → zero-based index.
export function columnLetterToIndex(letter: string): number {
  let n = 0;
  for (const ch of letter.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export const IMPORT_TARGETS = [
  "(ignore)", "agent",
  "created_at", "status", "business_name", "business_phone", "business_email",
  "website_link", "business_profile_link", "platform", "site_type",
  "services", "service_areas", "has_service_areas", "client_experience",
  "num_webpages", "specify_pages", "color_scheme", "image_links", "logo_link",
  "follow_up_time", "price_quoted", "direct_line_saved", "reference_link",
  "comments", "rating", "fresh_or_followup", "yearly_price", "map_embed_link",
] as const;

export const DEFAULT_MAPPING: Record<string, string> = {
  A: "created_at", B: "status", C: "website_link", D: "agent", E: "site_type",
  F: "business_name", G: "business_phone", H: "business_email", I: "platform",
  J: "business_profile_link", K: "services", L: "has_service_areas",
  M: "client_experience", N: "num_webpages", O: "specify_pages", P: "color_scheme",
  Q: "service_areas", R: "image_links", S: "logo_link", T: "follow_up_time",
  U: "price_quoted", V: "direct_line_saved", W: "reference_link", X: "comments",
  Y: "rating", Z: "fresh_or_followup", AA: "yearly_price", AB: "map_embed_link",
};
