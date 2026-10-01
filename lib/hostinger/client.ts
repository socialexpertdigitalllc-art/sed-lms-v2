// Hostinger REST client (production hosting + domains) for the custom-domain
// transfer and the deployments board. Base + auth + endpoints verified live
// against the account (2026-07-18, re-verified 2026-10-01):
//   GET  /api/domains/v1/portfolio                 -> registered domains
//   GET  /api/hosting/v1/websites[?domain=]          -> hosted websites (paginated)
//   POST /api/hosting/v1/websites {domain, order_id} -> add a domain as a website (async)
//   GET  /api/hosting/v1/onboardings?domain=         -> that setup's progress
//   POST /api/hosting/v1/files/upload-urls           -> file-server credentials
//   POST /api/hosting/v1/accounts/{u}/websites/{d}/deploy -> deploy a static archive (async)
//   GET/POST /api/hosting/v1/accounts/{u}/websites/{d}/ssl/{status,setup}
//   DELETE /api/hosting/v1/websites/{domain}         -> remove a website
// Auth: Authorization: Bearer HOSTINGER_API_TOKEN. Non-throwing + timeouts.
//
// Files: the plan migration put the client sites on a different Linux account
// than the LMS, so nothing here touches the local disk. The upload-URL
// credentials open Hostinger's file server (File Browser): TUS uploads for
// writes, and its REST API — same credentials — for exact, binary-safe reads.
// The documented files/content endpoint is NOT used for reads: it refuses
// binary files and returned a 7700-byte stylesheet as 7698 bytes.

import { unzipSync } from "fflate";

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

async function hgOnce(path: string, init: { method: "GET" | "POST" | "DELETE"; json?: unknown }): Promise<HgResult> {
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

/** Reads retry once on a network error (never on an HTTP answer); writes never
 *  retry — a POST that timed out may still have been applied. */
async function hg(path: string, init: { method: "GET" | "POST" | "DELETE"; json?: unknown }): Promise<HgResult> {
  const first = await hgOnce(path, init);
  if (first.status !== 0 || init.method !== "GET") return first;
  return hgOnce(path, init);
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

const sleepFor = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

// ---------------------------------------------------------------------------
// domains + websites

export interface HostingerDomain {
  id: number;
  domain: string;
  type: string;
  status: string;
  expires_at: string | null;
}

/**
 * Every registered domain in the account, or null when the portfolio can't be
 * read (a failed call must not look like "no domains"). Entries without a name
 * are dropped: a plan purchase leaves an unclaimed free domain in the portfolio
 * with `domain: null`, and that one entry crashed every transfer whose target
 * sorted after it.
 */
export async function listDomains(): Promise<HostingerDomain[] | null> {
  const r = await hg("/api/domains/v1/portfolio", { method: "GET" });
  if (!r.ok) return null;
  try {
    const arr = JSON.parse(r.body) as HostingerDomain[];
    if (!Array.isArray(arr)) return null;
    return arr.filter((d) => d && typeof d.domain === "string" && d.domain.length > 0);
  } catch {
    return null;
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
  /** What Hostinger detected on the website: "other" (plain static files),
   *  "wordpress", "nodejs", "builder", "horizons". */
  website_type?: string | null;
}

function parseWebsites(body: string): { data: HostingerWebsite[]; lastPage: number | null } {
  try {
    const j = JSON.parse(body) as {
      data?: HostingerWebsite[];
      meta?: { last_page?: number; total?: number; per_page?: number };
    };
    const data = Array.isArray(j.data) ? j.data : [];
    // The websites list reports {current_page, per_page, total} — no last_page.
    const m = j.meta;
    const lastPage = m?.last_page ?? (m?.total && m?.per_page ? Math.ceil(m.total / m.per_page) : null);
    return { data, lastPage };
  } catch {
    return { data: [], lastPage: 1 };
  }
}

const WEBSITES_PAGE = 100;

/** Every hosted website on every plan of the account, or null on any failure. */
export async function listWebsites(): Promise<HostingerWebsite[] | null> {
  const all: HostingerWebsite[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await hg(`/api/hosting/v1/websites?per_page=${WEBSITES_PAGE}&page=${page}`, { method: "GET" });
    if (!r.ok) return null;
    const { data, lastPage } = parseWebsites(r.body);
    all.push(...data);
    // Stop at the reported last page, or — when the response doesn't say —
    // at the first short page.
    if (data.length === 0 || (lastPage !== null ? page >= lastPage : data.length < WEBSITES_PAGE)) break;
  }
  return all;
}

/** The website for a domain (exact, case-insensitive), or null if none. */
export async function getWebsite(domain: string): Promise<HostingerWebsite | null> {
  const d = domain.toLowerCase();
  // the domain filter is a substring match — fetch a full page, pick the exact one
  const r = await hg(`/api/hosting/v1/websites?domain=${encodeURIComponent(d)}&per_page=100`, { method: "GET" });
  if (!r.ok) return null;
  return parseWebsites(r.body).data.find((w) => (w.domain ?? "").toLowerCase() === d) ?? null;
}

/** Only a plain static website can take a static archive deploy — the deploy
 *  wipes the docroot, so a WordPress/Node/Builder site would be destroyed. */
export function isStaticWebsite(w: { website_type?: string | null }): boolean {
  return !w.website_type || w.website_type === "other";
}

export function websiteTypeLabel(type: string | null | undefined): string {
  switch (type) {
    case "wordpress":
      return "WordPress";
    case "nodejs":
      return "Node.js";
    case "builder":
      return "Website Builder";
    case "horizons":
      return "Horizons";
    default:
      return "static";
  }
}

/**
 * The hosting plan's order_id: HOSTINGER_ORDER_ID when set (deterministic —
 * with two plans on the account, discovery order decides which plan new
 * websites land on, and the old plan is expiring), else discovered from any
 * existing website.
 */
export async function getHostingOrderId(): Promise<number | null> {
  const pinned = Number(process.env.HOSTINGER_ORDER_ID ?? "");
  if (Number.isInteger(pinned) && pinned > 0) return pinned;
  const r = await hg(`/api/hosting/v1/websites?per_page=1`, { method: "GET" });
  if (!r.ok) return null;
  return parseWebsites(r.body).data[0]?.order_id ?? null;
}

export type SetupStatus = "running" | "completed" | "failed";

/** Progress of a website setup started in the last 24h; null when none is
 *  listed, "unknown" when the endpoint can't be read. */
export async function getWebsiteSetupStatus(domain: string): Promise<SetupStatus | null | "unknown"> {
  const r = await hg(`/api/hosting/v1/onboardings?domain=${encodeURIComponent(domain.toLowerCase())}`, { method: "GET" });
  if (!r.ok) return "unknown";
  try {
    const arr = JSON.parse(r.body) as { domain?: string; status?: string }[];
    const mine = (Array.isArray(arr) ? arr : []).find((s) => (s.domain ?? "").toLowerCase() === domain.toLowerCase());
    const s = mine?.status;
    return s === "running" || s === "completed" || s === "failed" ? s : null;
  } catch {
    return "unknown";
  }
}

export type EnsureWebsiteResult =
  | { ok: true; website: HostingerWebsite; created: boolean }
  | { ok: false; pending?: boolean; message: string };

const SETUP_POLL_MS = 10000;
/** Long enough for a typical setup (1–3 min); the transfer then reports
 *  "still setting up, try again" instead of holding the request forever. */
export const SETUP_WAIT_MS = 180000;

/**
 * Make sure the domain is a website on the hosting plan and its setup has
 * FINISHED. Creating a website is asynchronous (a few minutes): it shows up
 * in the websites list before its server is ready, and file endpoints answer
 * 404/409 until the setup reports `completed`. A setup still running when the
 * wait ends comes back as `pending` — nothing was changed, retrying is safe.
 */
export async function ensureWebsite(
  domain: string,
  opts: { waitMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<EnsureWebsiteResult> {
  const sleep = opts.sleep ?? sleepFor;
  const waitMs = opts.waitMs ?? SETUP_WAIT_MS;
  const d = domain.toLowerCase();

  let created = false;
  const existing = await getWebsite(d);
  if (!existing) {
    const orderId = await getHostingOrderId();
    if (!orderId) return { ok: false, message: "could not resolve the hosting plan order id" };
    const r = await hg("/api/hosting/v1/websites", { method: "POST", json: { domain: d, order_id: orderId } });
    if (!r.ok && !/exist/i.test(r.body)) return { ok: false, message: messageOf(r) };
    created = true;
  }

  const pending = {
    ok: false as const,
    pending: true,
    message:
      `Hostinger is still setting up hosting for ${d} (this usually takes 1–3 minutes). ` +
      "Nothing was changed — try again shortly.",
  };
  // Counted polls, not wall-clock: deterministic, and an injected sleep can't spin.
  const maxPolls = Math.max(0, Math.floor(waitMs / SETUP_POLL_MS));
  for (let i = 0; ; i++) {
    const status = await getWebsiteSetupStatus(d);
    if (status === "failed") return { ok: false, message: `Hostinger could not finish setting up hosting for ${d}` };
    // An existing website with no setup running is ready. A website created
    // just now is ready once its setup reports completed — or, if the setup
    // never shows up in the list (or the list can't be read), after a few
    // polls; the file endpoints still answer 409 if it is not actually ready.
    if (status !== "running") {
      const website = existing && i === 0 ? existing : await getWebsite(d);
      if (website?.root_directory && (!created || status === "completed" || i >= 3)) {
        return { ok: true, website, created };
      }
    }
    if (i >= maxPolls) return pending;
    await sleep(SETUP_POLL_MS);
  }
}

// ---------------------------------------------------------------------------
// file server (TUS writes + File Browser reads behind the upload-URL credentials)

interface FileSession {
  /** TUS endpoint — uploads land in `dir`. */
  tusUrl: string;
  /** File Browser REST root, e.g. https://srv955-files.hstgr.io/rest/{id} */
  restBase: string;
  /** The website directory the session is scoped to, e.g. /public_html */
  dir: string;
  headers: Record<string, string>;
}

type SessionResult = { ok: true; session: FileSession } | { ok: false; pending?: boolean; message: string };

/** Credentials for the website's file server. A website still being set up
 *  answers 409 (pending — try again shortly). */
async function openFileSession(website: { domain: string; username: string }): Promise<SessionResult> {
  const gen = await hg("/api/hosting/v1/files/upload-urls", {
    method: "POST",
    json: { username: website.username, domain: website.domain },
  });
  if (gen.status === 409) {
    return { ok: false, pending: true, message: `${website.domain} is still being set up on Hostinger — try again shortly` };
  }
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
  let u: URL;
  try {
    u = new URL(creds.url);
  } catch {
    return { ok: false, message: "the upload URL is not a valid URL" };
  }
  // https://srvN-files.hstgr.io/rest/{id}/api/tus/public_html → rest root + dir
  const m = u.pathname.match(/^(.*?)\/api\/tus(\/.*)?$/);
  const restBase = `${u.origin}${(m ? m[1] : u.pathname).replace(/\/+$/, "")}`;
  const dir = (m?.[2] ?? "").replace(/\/+$/, "") || "/public_html";
  return {
    ok: true,
    session: {
      tusUrl: creds.url.replace(/\/+$/, ""),
      restBase,
      dir,
      headers: { "X-Auth": creds.auth_key, "X-Auth-Rest": creds.rest_auth_key },
    },
  };
}

const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** TUS uploads carry the whole zip (≤60MB) — far past the JSON calls' 30s. */
const UPLOAD_TIMEOUT_MS = 180000;

async function fileFetch(
  url: string,
  init: { method: "GET" | "POST" | "PATCH"; headers: Record<string, string>; body?: Uint8Array; timeoutMs?: number },
): Promise<{ ok: boolean; status: number; res: Response | null; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body as BodyInit | undefined,
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status, res };
  } catch (e) {
    return { ok: false, status: 0, res: null, error: e instanceof Error ? e.message : "network error" };
  } finally {
    clearTimeout(timer);
  }
}

/** Entry names directly inside a directory, or null when it can't be listed. */
async function listDir(session: FileSession, dir: string): Promise<string[] | null> {
  const r = await fileFetch(`${session.restBase}/api/resources${encodePath(dir)}/`, {
    method: "GET",
    headers: session.headers,
    timeoutMs: TIMEOUT_MS,
  });
  if (!r.ok || !r.res) return null;
  try {
    const j = (await r.res.json()) as { items?: { name?: string }[] };
    return (j.items ?? []).map((i) => String(i.name ?? ""));
  } catch {
    return null;
  }
}

export type DeployResult =
  | { ok: true; settled: boolean }
  | { ok: false; pending?: boolean; message: string };

const SETTLE_POLL_MS = 3000;
export const SETTLE_WAIT_MS = 60000;

/**
 * Replace a website's live files with a zip, entirely over the Hostinger API —
 * the deploy path that works across hosting accounts:
 *   1. file-server credentials for the website,
 *   2. TUS-upload the zip into public_html (create, then send the bytes),
 *   3. deploy-from-archive — the server clears the docroot and extracts,
 *   4. wait until the server has consumed the archive (the deploy endpoint only
 *      answers "Request accepted"): `settled` says it finished in the window.
 * Refuses non-static websites: the deploy would erase a WordPress/Node site.
 */
export async function deployZipToWebsite(
  website: { domain: string; username: string; website_type?: string | null },
  zipBytes: Uint8Array,
  opts: { settleMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<DeployResult> {
  if (!isStaticWebsite(website)) {
    return {
      ok: false,
      message:
        `${website.domain} is a ${websiteTypeLabel(website.website_type)} site on Hostinger — ` +
        "uploading static files would erase it, so it is managed in hPanel, not from the dashboard",
    };
  }
  const opened = await openFileSession(website);
  if (!opened.ok) return opened;
  const { session } = opened;

  const archiveName = `lms-deploy-${Date.now()}.zip`;
  const target = `${session.tusUrl}/${archiveName}?override=true`;
  const tusHeaders = { ...session.headers, "Tus-Resumable": "1.0.0" };

  const created = await fileFetch(target, {
    method: "POST",
    headers: { ...tusHeaders, "Upload-Length": String(zipBytes.length), "Upload-Offset": "0" },
  });
  if (!created.ok) {
    return { ok: false, message: `could not start the file upload (HTTP ${created.status || created.error})` };
  }

  const sent = await fileFetch(target, {
    method: "PATCH",
    headers: { ...tusHeaders, "Content-Type": "application/offset+octet-stream", "Upload-Offset": "0" },
    body: zipBytes,
  });
  if (!sent.ok) {
    return { ok: false, message: `the file upload did not complete (HTTP ${sent.status || sent.error})` };
  }

  const deployed = await hg(
    `/api/hosting/v1/accounts/${encodeURIComponent(website.username)}/websites/${encodeURIComponent(website.domain)}/deploy`,
    { method: "POST", json: { archive_path: archiveName } },
  );
  if (!deployed.ok) return { ok: false, message: `deploy failed: ${messageOf(deployed)}` };

  const settleMs = opts.settleMs ?? SETTLE_WAIT_MS;
  if (settleMs <= 0) return { ok: true, settled: false };
  const sleep = opts.sleep ?? sleepFor;
  const polls = Math.max(1, Math.ceil(settleMs / SETTLE_POLL_MS));
  for (let i = 0; i < polls; i++) {
    const names = await listDir(session, session.dir);
    if (names && !names.includes(archiveName)) return { ok: true, settled: true };
    if (i < polls - 1) await sleep(SETTLE_POLL_MS);
  }
  return { ok: true, settled: false };
}

/** Cumulative cap for a downloaded site — client sites upload as ≤60MB zips,
 *  but image-heavy sites edited in hPanel reach well past that. */
export const MAX_SITE_ZIP_BYTES = 400 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 240000;

type DownloadResult = { ok: true; zip: Uint8Array } | { ok: false; pending?: boolean; retryable?: boolean; message: string };

/** True when the bytes are a COMPLETE zip: the central directory at the end
 *  parses. A stream cut short still starts with "PK" — this catches it. */
function isCompleteZip(zip: Uint8Array): boolean {
  if (zip.length < 22 || zip[0] !== 0x50 || zip[1] !== 0x4b) return false;
  try {
    unzipSync(zip, { filter: () => false }); // walks the directory, inflates nothing
    return true;
  } catch {
    return false;
  }
}

async function downloadOnce(session: FileSession, maxBytes: number): Promise<DownloadResult> {
  // One controller for the WHOLE exchange: the timeout must cover reading the
  // body, not just receiving the headers.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(`${session.restBase}/api/raw${encodePath(session.dir)}?algo=zip`, {
      method: "GET",
      headers: session.headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, retryable: res.status >= 500, message: `could not download the site files (HTTP ${res.status})` };
    }
    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, message: `the site is too large to download here (${Math.round(declared / 1048576)}MB)` };
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          return { ok: false, message: `the site is too large to download here (over ${Math.round(maxBytes / 1048576)}MB)` };
        }
        chunks.push(value);
      }
    }
    const zip = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      zip.set(c, offset);
      offset += c.length;
    }
    if (zip.length < 4 || zip[0] !== 0x50 || zip[1] !== 0x4b) {
      return { ok: false, message: "the file server did not return a zip" };
    }
    if (!isCompleteZip(zip)) {
      return { ok: false, retryable: true, message: "the download was cut off before the end (incomplete zip)" };
    }
    return { ok: true, zip };
  } catch (e) {
    const aborted = controller.signal.aborted;
    return {
      ok: false,
      retryable: !aborted,
      message: aborted
        ? `the download did not finish within ${DOWNLOAD_TIMEOUT_MS / 1000}s`
        : `the download failed: ${e instanceof Error ? e.message : "network error"}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The website's live public_html as zip bytes, read through the file server —
 * exact bytes, binaries and dotfiles included, entries relative to the
 * docroot (verified byte-for-byte against the listing on live sites). Never
 * returns a truncated zip: the result is checked to be complete (one retry on
 * a dropped connection), because callers snapshot it or round-trip it into a
 * deploy that wipes the docroot — a partial copy would delete live files.
 */
export async function downloadWebsiteZip(
  website: { domain: string; username: string },
  opts: { maxBytes?: number } = {},
): Promise<{ ok: true; zip: Uint8Array } | { ok: false; pending?: boolean; message: string }> {
  const opened = await openFileSession(website);
  if (!opened.ok) return opened;
  const maxBytes = opts.maxBytes ?? MAX_SITE_ZIP_BYTES;
  const first = await downloadOnce(opened.session, maxBytes);
  if (first.ok || !first.retryable) return first.ok ? first : { ok: false, message: first.message };
  const second = await downloadOnce(opened.session, maxBytes);
  return second.ok ? second : { ok: false, message: second.message };
}

/**
 * Best-effort HTTPS for a freshly hosted domain: request the free lifetime
 * certificate when none is active. Returns the resulting SSL status, or null
 * when it can't be read. Installation runs in the background on Hostinger.
 */
export async function ensureSsl(website: { domain: string; username: string }): Promise<string | null> {
  const base = `/api/hosting/v1/accounts/${encodeURIComponent(website.username)}/websites/${encodeURIComponent(website.domain)}/ssl`;
  const st = await hg(`${base}/status`, { method: "GET" });
  if (!st.ok) return null;
  let status: string | null = null;
  try {
    status = (JSON.parse(st.body) as { status?: string }).status ?? null;
  } catch {
    return null;
  }
  if (status === "not_installed" || status === "failed" || status === "expired") {
    const setup = await hg(`${base}/setup`, { method: "POST" });
    return setup.ok ? "installing" : status;
  }
  return status;
}

/** Remove a website. Requires `confirm: true` (verified — 422 without it). */
export async function deleteWebsite(domain: string): Promise<{ ok: boolean; message?: string }> {
  const r = await hg(`/api/hosting/v1/websites/${encodeURIComponent(domain)}`, {
    method: "DELETE",
    json: { confirm: true },
  });
  return r.ok ? { ok: true } : { ok: false, message: messageOf(r) };
}
