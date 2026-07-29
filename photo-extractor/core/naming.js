// Pure filename helpers. No chrome/DOM dependencies.
// Keeps spaces and '-' (valid in filenames); replaces OS-illegal chars with '_';
// strips trailing dots/spaces; neutralizes '..' so a token cannot escape the folder.

export function sanitizeSegment(s) {
  let v = String(s ?? '').trim();
  v = v.replace(/[.\s]+$/g, '');         // strip trailing dots/spaces
  v = v.replace(/[<>:"/\\|?*]/g, '_');    // OS-illegal chars -> _ (spaces and '-' kept)
  v = v.replace(/[\x00-\x1f]/g, '_');     // control chars -> _
  v = v.replace(/\.\.+/g, '_');           // neutralize '..' (path traversal)
  v = v.replace(/_+/g, '_');              // collapse repeated underscores
  v = v.replace(/\s+/g, ' ');             // collapse whitespace
  v = v.slice(0, 120);
  return v || 'photo';
}

export function pad(n, width = 3) {
  return String(n ?? 0).padStart(width, '0');
}

// Tokens: {business} {index} {date}. '/' in the template separates folders; the
// extension is always appended as '.<ext>'. Each segment is sanitized so a token
// value cannot inject extra folders or '..' traversal.
export function buildFilename(template, { business, index, date, ext } = {}) {
  const tokens = {
    business: sanitizeSegment(business ?? 'business'),
    index: pad(index ?? 0),
    date: sanitizeSegment(date ?? ''),
  };
  const replaced = template.replace(/\{(business|index|date)\}/g, (_, k) => tokens[k]);
  const clean = replaced.split('/').map(sanitizeSegment).filter(Boolean);
  const safeExt = (sanitizeSegment(ext ?? 'jpg').replace(/^_+/, '') || 'jpg').toLowerCase();
  return `${clean.join('/') || 'photo'}.${safeExt}`;
}
