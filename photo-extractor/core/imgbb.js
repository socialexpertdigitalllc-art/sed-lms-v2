// imgbb upload helper. Public API: POST https://api.imgbb.com/1/upload?key=KEY
// The `image` field accepts an image URL (imgbb fetches it server-side), raw
// base64, or binary. NOTE: imgbb's public API has no album endpoint — uploads
// land in the account tied to the key but cannot be assigned to an album here.

const ENDPOINT = 'https://api.imgbb.com/1/upload';

async function post(key, imageValue, name, signal) {
  const form = new FormData();
  form.append('image', imageValue);
  if (name) form.append('name', name);
  const url = `${ENDPOINT}?key=${encodeURIComponent(key)}`;
  const resp = await fetch(url, { method: 'POST', body: form, signal });
  let data = null;
  try { data = await resp.json(); } catch { /* non-JSON error body */ }
  if (!resp.ok || !data || data.success === false || !data.data) {
    const msg = data?.error?.message || data?.status_txt || `HTTP ${resp.status}`;
    const err = new Error(msg);
    err.status = resp.status;
    throw err;
  }
  const d = data.data;
  return {
    url: d.url,                 // direct image url (i.ibb.co/...)
    displayUrl: d.display_url,
    viewerUrl: d.url_viewer,
    deleteUrl: d.delete_url,
    id: d.id,
    title: d.title,
    width: d.width,
    height: d.height,
  };
}

// Upload by passing the source image URL — imgbb fetches it server-side (lightest path).
export function uploadByUrl(key, imageUrl, name, signal) {
  return post(key, imageUrl, name, signal);
}

// Upload raw bytes as base64 (fallback when imgbb can't fetch the source URL).
export function uploadByBase64(key, base64, name, signal) {
  const raw = base64.includes(',') ? base64.split(',')[1] : base64;
  return post(key, raw, name, signal);
}

// True if the error indicates a missing/invalid API key (don't retry those).
export function isBadKeyError(e) {
  return /invalid api key|invalid key|api key|invalid request|400/i.test(String(e?.message || ''));
}
