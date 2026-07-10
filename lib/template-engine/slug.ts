/** Lowercase ascii slug for subdomains: alnum + hyphens, max 40 chars, fallback "site". */
export function businessSlug(name: string): string {
  const slug = (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents (Café -> Cafe)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "site";
}

/** 6-char base36 id from crypto randomness (uniqueness suffix, not a secret). */
export function websiteId(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += (bytes[i] % 36).toString(36);
  return out;
}
