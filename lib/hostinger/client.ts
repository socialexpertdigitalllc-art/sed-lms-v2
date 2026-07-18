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

/** The hosting plan's order_id, discovered from any existing website (no config). */
export async function getHostingOrderId(): Promise<number | null> {
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

/** Remove an addon website. Requires `confirm: true` (verified — 422 without it). */
export async function deleteWebsite(domain: string): Promise<{ ok: boolean; message?: string }> {
  const r = await hg(`/api/hosting/v1/websites/${encodeURIComponent(domain)}`, {
    method: "DELETE",
    json: { confirm: true },
  });
  return r.ok ? { ok: true } : { ok: false, message: messageOf(r) };
}
