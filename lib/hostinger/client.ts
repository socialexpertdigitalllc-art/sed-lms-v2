// Hostinger REST client (production hosting + domains) for the custom-domain
// transfer. Base + auth + endpoints VERIFIED live 2026-07-18 against the account:
//   GET  /api/domains/v1/portfolio                 -> registered domains
//   GET  /api/hosting/v1/websites?domain={d}        -> the addon website (or none),
//        each carrying its on-disk `root_directory` (the fs-deploy target)
//   POST /api/hosting/v1/websites {domain, order_id} -> add the domain as an addon
//   DELETE /api/hosting/v1/websites/{domain}         -> remove an addon website
// Auth: Authorization: Bearer HOSTINGER_API_TOKEN. Non-throwing + timeouts.

const BASE = "https://developers.hostinger.com";
const TIMEOUT_MS = 30000;

export function hostingerConfigured(): boolean {
  return Boolean(process.env.HOSTINGER_API_TOKEN);
}

interface HgResult {
  ok: boolean;
  status: number;
  body: string;
}

async function hg(path: string, init: { method: "GET" | "POST" | "DELETE"; json?: unknown }): Promise<HgResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${process.env.HOSTINGER_API_TOKEN ?? ""}`,
      Accept: "application/json",
    };
    let body: string | undefined;
    if (init.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.json);
    }
    const res = await fetch(`${BASE}${path}`, { method: init.method, headers, body, signal: controller.signal });
    return { ok: res.ok, status: res.status, body: await res.text() };
  } catch (e) {
    return { ok: false, status: 0, body: e instanceof Error ? e.message : "network error" };
  } finally {
    clearTimeout(timer);
  }
}

function messageOf(r: HgResult): string {
  try {
    const j = JSON.parse(r.body) as { message?: string; errors?: Record<string, string[]> };
    if (j.message) return j.message;
    if (j.errors) {
      return Object.values(j.errors).flat().join("; ");
    }
  } catch {
    // not json
  }
  return r.body ? r.body.slice(0, 200) : `HTTP ${r.status}`;
}

export interface HostingerDomain {
  id: number;
  domain: string;
  type: string;
  status: string;
  expires_at: string | null;
}

/** Every registered domain in the account (the dashboard's domain source). */
export async function listDomains(): Promise<HostingerDomain[]> {
  const r = await hg("/api/domains/v1/portfolio", { method: "GET" });
  if (!r.ok) return [];
  try {
    const arr = JSON.parse(r.body) as HostingerDomain[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export interface HostingerWebsite {
  domain: string;
  root_directory: string;
  vhost_type: string;
  order_id: number;
  is_enabled: boolean;
  /** The Linux account hosting this website — plans don't share a filesystem,
   *  so file operations must go through the API scoped to this username. */
  username: string;
}

function parseWebsites(body: string): HostingerWebsite[] {
  try {
    const j = JSON.parse(body) as { data?: HostingerWebsite[] };
    return Array.isArray(j.data) ? j.data : [];
  } catch {
    return [];
  }
}

/** The addon website for a domain (with its on-disk docroot), or null if none. */
export async function getWebsite(domain: string): Promise<HostingerWebsite | null> {
  const r = await hg(`/api/hosting/v1/websites?domain=${encodeURIComponent(domain)}`, { method: "GET" });
  if (!r.ok) return null;
  return parseWebsites(r.body).find((w) => w.domain === domain) ?? null;
}

/**
 * The hosting plan's order_id: HOSTINGER_ORDER_ID when set (deterministic —
 * with two plans on the account, discovery order decides which plan new addon
 * websites land on, and the old plan is expiring), else discovered from any
 * existing website.
 */
export async function getHostingOrderId(): Promise<number | null> {
  const pinned = Number(process.env.HOSTINGER_ORDER_ID ?? "");
  if (Number.isInteger(pinned) && pinned > 0) return pinned;
  const r = await hg(`/api/hosting/v1/websites?per_page=1`, { method: "GET" });
  if (!r.ok) return null;
  return parseWebsites(r.body)[0]?.order_id ?? null;
}

/**
 * Add a domain as an addon website on the hosting plan. Idempotent for us:
 * "already exists" is success. Returns the website (with its docroot) on success.
 */
export async function ensureWebsite(domain: string): Promise<{ ok: boolean; website?: HostingerWebsite; message?: string }> {
  const existing = await getWebsite(domain);
  if (existing) return { ok: true, website: existing };

  const orderId = await getHostingOrderId();
  if (!orderId) return { ok: false, message: "could not resolve the hosting plan order id" };

  const r = await hg("/api/hosting/v1/websites", { method: "POST", json: { domain, order_id: orderId } });
  if (!r.ok && !/exist/i.test(r.body)) {
    return { ok: false, message: messageOf(r) };
  }
  // Provisioning the docroot is async; poll getWebsite briefly for the root_directory.
  for (let i = 0; i < 10; i++) {
    const w = await getWebsite(domain);
    if (w?.root_directory) return { ok: true, website: w };
    await new Promise((res) => setTimeout(res, 2000));
  }
  return { ok: false, message: "website created but its docroot did not appear in time" };
}

/** TUS uploads carry the whole zip (≤60MB) — far past the JSON calls' 30s. */
const UPLOAD_TIMEOUT_MS = 180000;

async function tusFetch(
  url: string,
  init: { method: "POST" | "PATCH"; headers: Record<string, string>; body?: Uint8Array },
): Promise<HgResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body as BodyInit | undefined,
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status, body: await res.text() };
  } catch (e) {
    return { ok: false, status: 0, body: e instanceof Error ? e.message : "network error" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Replace a website's live files with a zip, entirely over the Hostinger API —
 * the deploy path that works across hosting accounts (the LMS no longer shares
 * a filesystem with the client sites since the plan migration). Three steps,
 * per the published OpenAPI spec:
 *   1. generate a TUS upload URL for the website's file storage,
 *   2. TUS-upload the zip into public_html (create, then send the bytes),
 *   3. deploy-from-archive — the server clears the docroot and extracts.
 * Non-throwing, like the rest of this client.
 */
export async function deployZipToWebsite(
  website: { domain: string; username: string },
  zipBytes: Uint8Array,
): Promise<{ ok: boolean; message?: string }> {
  const gen = await hg("/api/hosting/v1/files/upload-urls", {
    method: "POST",
    json: { username: website.username, domain: website.domain },
  });
  if (!gen.ok) return { ok: false, message: `could not get an upload URL: ${messageOf(gen)}` };
  let creds: { url?: string; auth_key?: string; rest_auth_key?: string };
  try {
    creds = JSON.parse(gen.body) as typeof creds;
  } catch {
    creds = {};
  }
  if (!creds.url || !creds.auth_key || !creds.rest_auth_key) {
    return { ok: false, message: "the upload-URL response is missing its credentials" };
  }

  const archiveName = `lms-deploy-${Date.now()}.zip`;
  const target = `${creds.url.replace(/\/+$/, "")}/${archiveName}?override=true`;
  const authHeaders = {
    "X-Auth": creds.auth_key,
    "X-Auth-Rest": creds.rest_auth_key,
    "Tus-Resumable": "1.0.0",
  };

  const created = await tusFetch(target, {
    method: "POST",
    headers: { ...authHeaders, "Upload-Length": String(zipBytes.length), "Upload-Offset": "0" },
  });
  if (!created.ok) {
    return { ok: false, message: `could not start the file upload (HTTP ${created.status})` };
  }

  const sent = await tusFetch(target, {
    method: "PATCH",
    headers: { ...authHeaders, "Content-Type": "application/offset+octet-stream", "Upload-Offset": "0" },
    body: zipBytes,
  });
  if (!sent.ok) {
    return { ok: false, message: `the file upload did not complete (HTTP ${sent.status})` };
  }

  const deployed = await hg(
    `/api/hosting/v1/accounts/${encodeURIComponent(website.username)}/websites/${encodeURIComponent(website.domain)}/deploy`,
    { method: "POST", json: { archive_path: archiveName } },
  );
  if (!deployed.ok) return { ok: false, message: `deploy failed: ${messageOf(deployed)}` };
  return { ok: true };
}

/** Remove an addon website. Requires `confirm: true` (verified — 422 without it). */
export async function deleteWebsite(domain: string): Promise<{ ok: boolean; message?: string }> {
  const r = await hg(`/api/hosting/v1/websites/${encodeURIComponent(domain)}`, {
    method: "DELETE",
    json: { confirm: true },
  });
  return r.ok ? { ok: true } : { ok: false, message: messageOf(r) };
}
