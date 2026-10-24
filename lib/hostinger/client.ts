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

async function hgOnce(path: string, init: { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; json?: unknown }): Promise<HgResult> {
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
async function hg(path: string, init: { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; json?: unknown }): Promise<HgResult> {
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
  created_at?: string | null;
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

/**
 * Every website of one hosting account (they share its filesystem), or null
 * when the list can't be read in full. Asked by username, and checked by
 * username again, whatever the API does with the filter.
 */
export async function listAccountWebsites(username: string): Promise<HostingerWebsite[] | null> {
  const all: HostingerWebsite[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await hg(`/api/hosting/v1/websites?username=${encodeURIComponent(username)}&per_page=${WEBSITES_PAGE}&page=${page}`, { method: "GET" });
    if (!r.ok) return null;
    let j: { data?: unknown; meta?: { last_page?: number; total?: number; per_page?: number } };
    try {
      j = JSON.parse(r.body) as typeof j;
    } catch {
      return null;
    }
    if (!Array.isArray(j.data)) return null;
    const data = j.data as HostingerWebsite[];
    all.push(...data);
    const m = j.meta;
    const lastPage = m?.last_page ?? (m?.total && m?.per_page ? Math.ceil(m.total / m.per_page) : null);
    if (data.length === 0 || (lastPage !== null ? page >= lastPage : data.length < WEBSITES_PAGE)) return all.filter((w) => w.username === username);
  }
  return null; // more than 20 pages: not read in full
}

/** The website for a domain (exact, case-insensitive), or null if none. */
export async function getWebsite(domain: string): Promise<HostingerWebsite | null> {
  const w = await findWebsite(domain);
  return w === "error" ? null : w;
}

/** Like getWebsite, but a failed read is "error" — never mistaken for "no website". */
export async function findWebsite(domain: string): Promise<HostingerWebsite | null | "error"> {
  const d = domain.toLowerCase();
  // the domain filter is a substring match — fetch a full page, pick the exact one
  const r = await hg(`/api/hosting/v1/websites?domain=${encodeURIComponent(d)}&per_page=100`, { method: "GET" });
  if (!r.ok) return "error";
  return parseWebsites(r.body).data.find((w) => (w.domain ?? "").toLowerCase() === d) ?? null;
}

export interface WebsiteFile {
  name: string;
  /** relative to the website folder (public_html); no "/" = top level */
  path: string;
  type: string;
  size: number | null;
}

/** What sits at the top of a website's folder, or null when it can't be read. */
export async function listWebsiteFiles(website: { domain: string; username: string }): Promise<WebsiteFile[] | null> {
  const r = await hg(
    `/api/hosting/v1/accounts/${encodeURIComponent(website.username)}/domains/${encodeURIComponent(website.domain)}/files?max_depth=1&max_items=500`,
    { method: "GET" },
  );
  if (!r.ok) return null;
  try {
    const j = JSON.parse(r.body) as { items?: { name?: string; path?: string; type?: string; size_bytes?: number }[] };
    if (!Array.isArray(j.items)) return null;
    return j.items.map((i) => ({
      name: i.name ?? "",
      path: i.path ?? i.name ?? "",
      type: i.type ?? "file",
      size: typeof i.size_bytes === "number" ? i.size_bytes : null,
    }));
  } catch {
    return null;
  }
}

/** A homepage at the top of the folder: a site someone put there. (Hostinger's
 *  own placeholder for a new website is default.php, which doesn't count.) */
export function hasIndexPage(files: WebsiteFile[]): boolean {
  return files.some((f) => f.type === "file" && !f.path.includes("/") && /^index.(html?|php)$/i.test(f.name));
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

export interface FileSession {
  /** TUS endpoint — uploads land in `dir`. */
  tusUrl: string;
  /** File Browser REST root, e.g. https://srv955-files.hstgr.io/rest/{id} */
  restBase: string;
  /** The website directory the session is scoped to, e.g. /public_html */
  dir: string;
  headers: Record<string, string>;
}

export type SessionResult = { ok: true; session: FileSession } | { ok: false; pending?: boolean; message: string };

/** Credentials for the website's file server. A website still being set up
 *  answers 409 (pending — try again shortly). */
export async function openFileSession(website: { domain: string; username: string }): Promise<SessionResult> {
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
  init: { method: "GET" | "POST" | "PATCH" | "DELETE"; headers: Record<string, string>; body?: Uint8Array; timeoutMs?: number },
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

// ---------------------------------------------------------------------------
// single files (SED CMS publishing): one folder listing, one exact read, one
// TUS write at a time — never the whole docroot. Paths are relative to the
// website's folder and are checked by the caller (lib/sedcms/paths.ts).
// Every call here has its own 30 s, through an AbortSignal; reads and
// listings also stop when the caller's signal aborts (SED CMS's deadline).

/** One single-file call: the request, and the body it reads. */
const SINGLE_FILE_TIMEOUT_MS = 30000;
/** A folder listing is small JSON; anything bigger is not one. */
const MAX_LISTING_BYTES = 8 * 1024 * 1024;

type CappedBody =
  | { ok: true; status: number; bytes: Uint8Array }
  | { ok: false; status: number; tooLarge: boolean; aborted: boolean; message: string };

/** Abort `controller` when `outer` does; returns the unhooking. */
function followSignal(controller: AbortController, outer: AbortSignal | undefined): () => void {
  if (!outer) return () => {};
  if (outer.aborted) {
    controller.abort();
    return () => {};
  }
  const stop = () => controller.abort();
  outer.addEventListener("abort", stop, { once: true });
  return () => outer.removeEventListener("abort", stop);
}

/**
 * One GET whose timeout covers the whole body, read up to maxBytes and
 * refused past it while streaming. A non-2xx answer's body is not read.
 */
async function getCapped(
  url: string,
  headers: Record<string, string>,
  maxBytes: number,
  timeoutMs: number,
  outer?: AbortSignal,
): Promise<CappedBody> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const unfollow = followSignal(controller, outer);
  try {
    const res = await fetch(url, { method: "GET", headers, signal: controller.signal });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: true, status: res.status, bytes: new Uint8Array() };
    }
    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, status: res.status, tooLarge: true, aborted: false, message: `larger than ${maxBytes} bytes` };
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
          return { ok: false, status: res.status, tooLarge: true, aborted: false, message: `larger than ${maxBytes} bytes` };
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    return { ok: true, status: res.status, bytes };
  } catch (e) {
    const aborted = controller.signal.aborted;
    const message = outer?.aborted ? "stopped by the caller" : aborted ? `no answer within ${timeoutMs / 1000}s` : e instanceof Error ? e.message : "network error";
    return { ok: false, status: 0, tooLarge: false, aborted, message };
  } finally {
    clearTimeout(timer);
    unfollow();
  }
}

/** A GET retried once on a network error — never after a timeout, a stop,
 *  an HTTP answer or a size refusal, and never once the caller's signal has
 *  aborted. Each try has its own timeout. */
async function getCappedRetrying(
  url: string,
  headers: Record<string, string>,
  maxBytes: number,
  timeoutMs: number,
  outer?: AbortSignal,
): Promise<CappedBody> {
  const first = await getCapped(url, headers, maxBytes, timeoutMs, outer);
  if (first.ok || first.tooLarge || first.aborted || first.status !== 0 || outer?.aborted) return first;
  return getCapped(url, headers, maxBytes, timeoutMs, outer);
}

export interface WebsiteDirEntry {
  name: string;
  /** "other": a symbolic link, or anything not plainly a file or a folder; never followed. */
  kind: "file" | "dir" | "other";
  size: number | null;
}

/**
 * Go's os.FileMode bits (the File Browser's `mode`) for what is neither a
 * regular file nor a folder: a link, a device, a pipe, a socket, a character
 * device, irregular.
 */
const NOT_PLAIN_MODE = (1 << 27) | (1 << 26) | (1 << 25) | (1 << 24) | (1 << 21) | (1 << 19);

/**
 * What a File Browser item is. Fails closed: a file or a folder only when the
 * item says so plainly (isSymlink false, isDir a boolean, no special mode
 * bits); anything missing, unknown or marked a link is "other".
 */
function itemKind(i: { isDir?: unknown; isSymlink?: unknown; mode?: unknown }): WebsiteDirEntry["kind"] {
  if (i.isSymlink !== false) return "other";
  if (i.mode !== undefined && (typeof i.mode !== "number" || (i.mode & NOT_PLAIN_MODE) !== 0)) return "other";
  if (i.isDir === true) return "dir";
  if (i.isDir === false) return "file";
  return "other";
}

/**
 * The entries directly inside one folder of the website ("" = its docroot),
 * from the File Browser's resources listing; null when it can't be listed
 * (in time).
 */
export async function listWebsiteDir(
  session: FileSession,
  relDir: string,
  opts: { signal?: AbortSignal } = {},
): Promise<WebsiteDirEntry[] | null> {
  const dir = relDir ? `${session.dir}/${relDir}` : session.dir;
  const r = await getCappedRetrying(`${session.restBase}/api/resources${encodePath(dir)}/`, session.headers, MAX_LISTING_BYTES, SINGLE_FILE_TIMEOUT_MS, opts.signal);
  if (!r.ok || r.status < 200 || r.status >= 300) return null;
  try {
    const j = JSON.parse(new TextDecoder().decode(r.bytes)) as {
      items?: { name?: unknown; size?: unknown; isDir?: unknown; isSymlink?: unknown; mode?: unknown }[] | null;
    };
    if (j.items === null) return []; // an empty folder
    if (!Array.isArray(j.items)) return null;
    return j.items.map((i) => ({
      name: typeof i.name === "string" ? i.name : "",
      kind: itemKind(i),
      size: typeof i.size === "number" && Number.isFinite(i.size) && i.size >= 0 ? i.size : null,
    }));
  } catch {
    return null;
  }
}

/**
 * One file's exact bytes through the File Browser's raw endpoint — the same
 * read downloadWebsiteZip trusts, for one file instead of an archive. null when
 * the server has no such file (404). Refused past maxBytes while streaming.
 * The caller makes sure the path is a file: raw on a folder returns a zip.
 */
export async function readWebsiteFile(
  session: FileSession,
  relPath: string,
  maxBytes: number,
  opts: { signal?: AbortSignal } = {},
): Promise<{ ok: true; bytes: Uint8Array | null } | { ok: false; tooLarge: boolean; message: string }> {
  const r = await getCappedRetrying(
    `${session.restBase}/api/raw${encodePath(session.dir)}/${encodePath(relPath)}`,
    session.headers,
    maxBytes,
    SINGLE_FILE_TIMEOUT_MS,
    opts.signal,
  );
  if (!r.ok) return { ok: false, tooLarge: r.tooLarge, message: r.message };
  if (r.status === 404) return { ok: true, bytes: null };
  if (r.status < 200 || r.status >= 300) return { ok: false, tooLarge: false, message: `HTTP ${r.status}` };
  return { ok: true, bytes: r.bytes };
}

// SED CMS never writes a live file in place: the TUS create, under
// override=true, may empty the file it targets at once (filebrowser opens it
// with O_TRUNC), so a failed upload would leave a page blank. A write goes to
// a temporary file instead (uploadWebsiteFile), is checked (statWebsiteFile),
// and replaces the live file in ONE rename (moveWebsiteFile). Paths here are
// the File Browser's own, from its root, which holds public_html.

type FileStep = { ok: true } | { ok: false; message: string };

/**
 * Upload bytes by TUS to a file of the File Browser (absPath, e.g. a
 * temporary file next to public_html), replacing one of that name. The create
 * and the bytes each have 30 s; `canContinue` is asked between them, and when
 * it says no the bytes are never sent (`stopped`).
 */
export async function uploadWebsiteFile(
  session: FileSession,
  absPath: string,
  bytes: Uint8Array,
  opts: { canContinue?: () => boolean } = {},
): Promise<{ ok: true } | { ok: false; stopped?: boolean; message: string }> {
  const target = `${session.restBase}/api/tus${encodePath(absPath)}?override=true`;
  const tusHeaders = { ...session.headers, "Tus-Resumable": "1.0.0" };

  const created = await fileFetch(target, {
    method: "POST",
    headers: { ...tusHeaders, "Upload-Length": String(bytes.length), "Upload-Offset": "0" },
    timeoutMs: SINGLE_FILE_TIMEOUT_MS,
  });
  await created.res?.body?.cancel().catch(() => {});
  if (!created.ok) return { ok: false, message: `could not start the upload (HTTP ${created.status || created.error})` };
  if (opts.canContinue && !opts.canContinue()) return { ok: false, stopped: true, message: "stopped before the bytes were sent" };

  const sent = await fileFetch(target, {
    method: "PATCH",
    headers: { ...tusHeaders, "Content-Type": "application/offset+octet-stream", "Upload-Offset": "0" },
    body: bytes,
    timeoutMs: SINGLE_FILE_TIMEOUT_MS,
  });
  await sent.res?.body?.cancel().catch(() => {});
  if (!sent.ok) return { ok: false, message: `the upload did not complete (HTTP ${sent.status || sent.error})` };
  const offset = sent.res?.headers.get("upload-offset") ?? null;
  if (offset !== null && offset !== String(bytes.length)) {
    return { ok: false, message: `the upload stopped at ${offset} of ${bytes.length} bytes` };
  }
  return { ok: true };
}

/** A file's info answer can carry a text file's content; past this it is refused. */
const MAX_FILE_INFO_BYTES = 16 * 1024 * 1024;

/**
 * A file's size and, where the File Browser computes one, its sha256 — GET
 * resources/<path>?checksum=sha256, hashed on the server, so nothing is
 * downloaded. sha256 is null when the answer carries none.
 */
export async function statWebsiteFile(
  session: FileSession,
  absPath: string,
  opts: { signal?: AbortSignal } = {},
): Promise<{ ok: true; isDir: boolean; isPlainFile: boolean; size: number | null; sha256: string | null } | { ok: false; message: string }> {
  const r = await getCappedRetrying(
    `${session.restBase}/api/resources${encodePath(absPath)}?checksum=sha256`,
    session.headers,
    MAX_FILE_INFO_BYTES,
    SINGLE_FILE_TIMEOUT_MS,
    opts.signal,
  );
  if (!r.ok) return { ok: false, message: r.message };
  if (r.status < 200 || r.status >= 300) return { ok: false, message: `HTTP ${r.status}` };
  try {
    const j = JSON.parse(new TextDecoder().decode(r.bytes)) as {
      isDir?: unknown;
      isSymlink?: unknown;
      mode?: unknown;
      size?: unknown;
      checksums?: { sha256?: unknown } | null;
    };
    const sha256 = typeof j.checksums?.sha256 === "string" && /^[0-9a-f]{64}$/i.test(j.checksums.sha256) ? j.checksums.sha256.toLowerCase() : null;
    return {
      ok: true,
      isDir: j.isDir === true,
      /** only when the answer says so plainly (as a listing item must) */
      isPlainFile: itemKind(j) === "file",
      size: typeof j.size === "number" && Number.isFinite(j.size) && j.size >= 0 ? j.size : null,
      sha256,
    };
  } catch {
    return { ok: false, message: "the file info was not JSON" };
  }
}

/** Run one small File Browser call with its own 30 s; its answer's body is dropped. */
async function fileCall(url: string, method: "POST" | "PATCH" | "DELETE", headers: Record<string, string>): Promise<{ ok: boolean; status: number; error?: string }> {
  const r = await fileFetch(url, { method, headers, timeoutMs: SINGLE_FILE_TIMEOUT_MS });
  await r.res?.body?.cancel().catch(() => {});
  return { ok: r.ok, status: r.status, error: r.error };
}

/**
 * Replace `toAbs` with `fromAbs` in ONE call: the File Browser's rename with
 * override (PATCH resources/<from>?action=rename&destination=<to>&override=true),
 * a rename(2) on the server when both are on one filesystem. Never retried.
 *
 * UNVERIFIED (the live spike): filebrowser's move falls back to copy, then
 * remove, when the rename fails, and a copy over the live file is not one
 * step. The spike checks what a failed rename does on Hostinger, and that
 * the folder holding public_html is on public_html's filesystem. A failed
 * move is always reported as one that may have changed the live file.
 */
export async function moveWebsiteFile(session: FileSession, fromAbs: string, toAbs: string): Promise<FileStep> {
  const q = `action=rename&destination=${encodeURIComponent(encodePath(toAbs))}&override=true`;
  const r = await fileCall(`${session.restBase}/api/resources${encodePath(fromAbs)}?${q}`, "PATCH", session.headers);
  return r.ok ? { ok: true } : { ok: false, message: `the move did not complete (HTTP ${r.status || r.error})` };
}

/** Remove one file; one already gone counts as removed. */
export async function removeWebsiteFile(session: FileSession, absPath: string): Promise<FileStep> {
  const r = await fileCall(`${session.restBase}/api/resources${encodePath(absPath)}`, "DELETE", session.headers);
  return r.ok || r.status === 404 ? { ok: true } : { ok: false, message: `the removal did not complete (HTTP ${r.status || r.error})` };
}

/** Make a folder (and its parents): the File Browser's POST resources/<dir>/. Writes no file. */
export async function makeWebsiteFolder(session: FileSession, absDir: string): Promise<FileStep> {
  const r = await fileCall(`${session.restBase}/api/resources${encodePath(absDir)}/`, "POST", session.headers);
  return r.ok ? { ok: true } : { ok: false, message: `the folder could not be made (HTTP ${r.status || r.error})` };
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

// ---------------------------------------------------------------------------
// Hostinger as the registrar — the option for clients who need access to their
// domain (Cloudflare stays the default: same price the first year, $10 less per
// renewal). Verified against the account 2026-10-02:
//   POST /api/domains/v1/availability {domain:label, tlds:[tld]} -> [{domain, is_available, restriction}]
//   GET  /api/billing/v1/catalog?category=DOMAIN&name=.COM*      -> item "hostingercom-domain-com",
//        price "hostingercom-domain-com-usd-1y" {price (renewal), first_period_price} in cents
//   POST /api/domains/v1/portfolio {domain, item_id} -> 200 order {status, subscription_id} |
//        202 {status: payment_initiated} = paid later, NOT registered (finish with /setup)
//   POST /api/hosting/v1/domains/verify-ownership {domain} -> {is_accessible, txt_to_verify}

/** "jjremodeling.com" -> ["jjremodeling", "com"]; "x.com.co" -> ["x", "com.co"]. */
function splitDomain(domain: string): [string, string] {
  const i = domain.indexOf(".");
  return [domain.slice(0, i), domain.slice(i + 1)];
}

export async function checkHostingerAvailability(
  domain: string,
): Promise<{ available: boolean; restriction: string | null } | null> {
  const [label, tld] = splitDomain(domain.toLowerCase());
  if (!label || !tld) return null;
  const r = await hg("/api/domains/v1/availability", {
    method: "POST",
    json: { domain: label, tlds: [tld], with_alternatives: false },
  });
  if (!r.ok) return null;
  try {
    const arr = JSON.parse(r.body) as { domain: string | null; is_available: boolean; restriction: string | null }[];
    const hit = (Array.isArray(arr) ? arr : []).find((a) => (a.domain ?? "").toLowerCase() === domain.toLowerCase());
    return hit ? { available: Boolean(hit.is_available), restriction: hit.restriction ?? null } : null;
  } catch {
    return null;
  }
}

export interface HostingerDomainPrice {
  /** Catalog price item to order, e.g. "hostingercom-domain-com-usd-1y". */
  itemId: string;
  firstCents: number;
  renewCents: number;
  currency: string;
}

/** The 1-year USD price item for an extension, from the account's catalog. */
export async function getHostingerDomainPrice(tld: string): Promise<HostingerDomainPrice | null> {
  const t = tld.toLowerCase().replace(/^\./, "");
  const r = await hg(`/api/billing/v1/catalog?category=DOMAIN&name=${encodeURIComponent(`.${t.toUpperCase()}*`)}`, {
    method: "GET",
  });
  if (!r.ok) return null;
  try {
    const items = JSON.parse(r.body) as {
      id: string;
      prices?: { id: string; currency: string; price: number; first_period_price?: number; period: number; period_unit: string }[];
    }[];
    const item = (Array.isArray(items) ? items : []).find((i) => i.id === `hostingercom-domain-${t.replace(/\./g, "")}`);
    const price = item?.prices?.find((p) => p.period === 1 && p.period_unit === "year" && p.currency === "USD");
    if (!price) return null;
    return { itemId: price.id, firstCents: price.first_period_price ?? price.price, renewCents: price.price, currency: price.currency };
  } catch {
    return null;
  }
}

export type HostingerPurchaseResult =
  | {
      ok: true;
      /** False when Hostinger took the order but the payment is still processing
       *  (202): the domain is NOT registered yet — finish with completeDomainSetup. */
      registered: boolean;
      orderStatus: string;
      orderId: number | null;
      subscriptionId: string | null;
    }
  | { ok: false; message: string };

/**
 * Buy a domain on Hostinger — CHARGES the account's default payment method.
 * Uses the account's default WHOIS contact for the extension.
 */
export async function purchaseHostingerDomain(domain: string, itemId: string): Promise<HostingerPurchaseResult> {
  const r = await hg("/api/domains/v1/portfolio", { method: "POST", json: { domain: domain.toLowerCase(), item_id: itemId } });
  if (!r.ok) return { ok: false, message: messageOf(r) };
  try {
    const j = JSON.parse(r.body) as { id?: number; subscription_id?: string | null; status?: string };
    const status = j.status ?? (r.status === 202 ? "payment_initiated" : "unknown");
    return {
      ok: true,
      registered: r.status !== 202 && status === "completed",
      orderStatus: status,
      orderId: typeof j.id === "number" ? j.id : null,
      subscriptionId: j.subscription_id ?? null,
    };
  } catch {
    return { ok: false, message: "unreadable purchase response" };
  }
}

export interface HostingerPortfolioStatus {
  /** Lowercased: active, pending_setup, requested, pending_verification, expired, … */
  status: string;
  /** Hostinger's own note on the domain, when it gives one. */
  message: string | null;
  expiresAt: string | null;
  registeredAt: string | null;
}

/** Of several portfolio entries for one name, the current one: not expired
 *  over expired, a registration still in progress (no expiry yet) over a
 *  finished one, then the one that expires last. */
function currentEntry(entries: HostingerDomain[]): HostingerDomain {
  const rank = (d: HostingerDomain) => [(d.status ?? "").toLowerCase() === "expired" ? 0 : 1, d.expires_at ? 0 : 1, d.expires_at ?? ""] as const;
  return entries.reduce((a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i] > ra[i] ? b : a;
    return a;
  });
}

/**
 * Where a domain stands in the account: its status, null when Hostinger does
 * not list it (yet), or "error" when the account couldn't be read.
 *
 * The domain's own page answers only once it is registered. A paid order that
 * is still being registered (pending_setup, requested, …) shows up only in
 * the portfolio LIST, so that is asked too. Without it such an order read as
 * "not in the account yet" for good, and its setup was never finished
 * (odneyremodeling.com, 2026-10-12).
 */
export async function getHostingerPortfolioDomain(domain: string): Promise<HostingerPortfolioStatus | null | "error"> {
  const name = domain.toLowerCase();
  const r = await hg(`/api/domains/v1/portfolio/${encodeURIComponent(name)}`, { method: "GET" });
  if (r.ok) {
    try {
      const j = JSON.parse(r.body) as { status?: string | null; message?: string | null; expires_at?: string | null; registered_at?: string | null };
      if (j.status) {
        return { status: j.status.toLowerCase(), message: j.message ?? null, expiresAt: j.expires_at ?? null, registeredAt: j.registered_at ?? null };
      }
    } catch {
      /* unreadable — the list below answers */
    }
  }
  const all = await listDomains();
  if (!all) return "error";
  const listed = all.filter((d) => d.domain.toLowerCase() === name);
  if (listed.length === 0) return null;
  const d = currentEntry(listed);
  return {
    status: (d.status ?? "").toLowerCase() || "unknown",
    message: null,
    expiresAt: d.expires_at ?? null,
    registeredAt: d.created_at ?? null,
  };
}

/** Register a paid-but-not-set-up domain (no new order, no new charge).
 *  `status` is Hostinger's HTTP status on a refusal (0: no answer). */
export async function completeHostingerDomainSetup(domain: string): Promise<{ ok: boolean; status?: number; message?: string }> {
  const r = await hg(`/api/domains/v1/portfolio/${encodeURIComponent(domain.toLowerCase())}/setup`, { method: "POST", json: {} });
  return r.ok ? { ok: true } : { ok: false, status: r.status, message: messageOf(r) };
}

/** Make sure a Hostinger subscription (e.g. a domain) renews by itself. */
export async function enableHostingerAutoRenew(subscriptionId: string): Promise<{ ok: boolean; message?: string }> {
  const r = await hg(`/api/billing/v1/subscriptions/${encodeURIComponent(subscriptionId)}/auto-renewal/enable`, {
    method: "PATCH",
  });
  return r.ok ? { ok: true } : { ok: false, message: messageOf(r) };
}

/**
 * Can this domain be used for a NEW website? An unused domain is accessible; a
 * domain already used by a website (ours included) is not; a TXT record is
 * offered only when another Hostinger customer has the domain.
 */
export async function verifyDomainOwnership(domain: string): Promise<{ accessible: boolean; txt: string | null } | null> {
  const r = await hg("/api/hosting/v1/domains/verify-ownership", { method: "POST", json: { domain: domain.toLowerCase() } });
  if (!r.ok) return null;
  try {
    const j = JSON.parse(r.body) as { is_accessible?: boolean; txt_to_verify?: string | null };
    return { accessible: Boolean(j.is_accessible), txt: j.txt_to_verify ? j.txt_to_verify : null };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// registrar management: subscriptions, domain settings, DNS zone, forwarding,
// moving a domain to another Hostinger account

type Done = { ok: true } | { ok: false; message: string };
const done = (r: HgResult): Done => (r.ok ? { ok: true } : { ok: false, message: messageOf(r) });
const enc = (domain: string) => encodeURIComponent(domain.toLowerCase());

export interface HostingerSubscription {
  id: string;
  /** ".COM Domain", "Cloud Startup", … — a domain subscription never names its domain. */
  name: string;
  /** active | not_renewing | non_renewing | cancelled | … */
  status: string;
  is_auto_renewed: boolean;
  /** cents */
  renewal_price: number | null;
  total_price: number | null;
  currency_code: string | null;
  created_at: string | null;
  expires_at: string | null;
  next_billing_at: string | null;
}

/** Every billing subscription on the account, or null when unreadable. */
export async function listSubscriptions(): Promise<HostingerSubscription[] | null> {
  const r = await hg("/api/billing/v1/subscriptions", { method: "GET" });
  if (!r.ok) return null;
  try {
    const arr = JSON.parse(r.body) as HostingerSubscription[];
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

export interface HostingerDomainDetails {
  status: string;
  message: string | null;
  locked: boolean | null;
  lockable: boolean | null;
  privacy: boolean | null;
  privacyAllowed: boolean | null;
  nameservers: string[];
  registeredAt: string | null;
  expiresAt: string | null;
}

/** A portfolio domain's registrar settings (lock, privacy, nameservers, …). */
export async function getHostingerDomainDetails(domain: string): Promise<HostingerDomainDetails | null> {
  const r = await hg(`/api/domains/v1/portfolio/${enc(domain)}`, { method: "GET" });
  if (!r.ok) return null;
  try {
    const j = JSON.parse(r.body) as {
      status?: string;
      message?: string | null;
      is_locked?: boolean;
      is_lockable?: boolean;
      is_privacy_protected?: boolean;
      is_privacy_protection_allowed?: boolean;
      name_servers?: Record<string, string | null> | null;
      registered_at?: string | null;
      expires_at?: string | null;
    };
    const ns = j.name_servers ?? {};
    return {
      status: (j.status ?? "").toLowerCase(),
      message: j.message ?? null,
      locked: typeof j.is_locked === "boolean" ? j.is_locked : null,
      lockable: typeof j.is_lockable === "boolean" ? j.is_lockable : null,
      privacy: typeof j.is_privacy_protected === "boolean" ? j.is_privacy_protected : null,
      privacyAllowed: typeof j.is_privacy_protection_allowed === "boolean" ? j.is_privacy_protection_allowed : null,
      nameservers: Object.keys(ns)
        .sort()
        .map((k) => ns[k])
        .filter((n): n is string => typeof n === "string" && n.length > 0),
      registeredAt: j.registered_at ?? null,
      expiresAt: j.expires_at ?? null,
    };
  } catch {
    return null;
  }
}

/** Transfer lock on/off (off is needed before a transfer to another registrar). */
export async function setHostingerDomainLock(domain: string, on: boolean): Promise<Done> {
  return done(await hg(`/api/domains/v1/portfolio/${enc(domain)}/domain-lock`, { method: on ? "PUT" : "DELETE" }));
}

/** WHOIS privacy protection on/off. */
export async function setHostingerPrivacy(domain: string, on: boolean): Promise<Done> {
  return done(await hg(`/api/domains/v1/portfolio/${enc(domain)}/privacy-protection`, { method: on ? "PUT" : "DELETE" }));
}

/** Point the domain at other nameservers (2–4). Wrong values take the domain offline. */
export async function setHostingerNameservers(domain: string, nameservers: string[]): Promise<Done> {
  const ns = nameservers.map((n) => n.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean);
  if (ns.length < 2 || ns.length > 4) return { ok: false, message: "Give 2 to 4 nameservers" };
  const json: Record<string, string> = {};
  ns.forEach((n, i) => (json[`ns${i + 1}`] = n));
  return done(await hg(`/api/domains/v1/portfolio/${enc(domain)}/nameservers`, { method: "PUT", json }));
}

/** The transfer (EPP) code. Each call invalidates the previous code. */
export async function getHostingerAuthCode(domain: string): Promise<{ ok: true; code: string | null } | { ok: false; message: string }> {
  const r = await hg(`/api/domains/v1/portfolio/${enc(domain)}/auth-code`, { method: "GET" });
  if (!r.ok) return { ok: false, message: messageOf(r) };
  try {
    return { ok: true, code: (JSON.parse(r.body) as { auth_code?: string | null }).auth_code ?? null };
  } catch {
    return { ok: false, message: "unreadable response" };
  }
}

/** Stop a subscription (e.g. a domain) from renewing by itself. */
export async function disableHostingerAutoRenew(subscriptionId: string): Promise<Done> {
  return done(await hg(`/api/billing/v1/subscriptions/${encodeURIComponent(subscriptionId)}/auto-renewal/disable`, { method: "DELETE" }));
}

/**
 * Renew a subscription NOW — CHARGES the default payment method. `pending`
 * means Hostinger took the order but the payment is still processing.
 */
export async function renewHostingerSubscription(
  subscriptionId: string,
): Promise<{ ok: true; pending: boolean; orderStatus: string; totalCents: number | null } | { ok: false; message: string }> {
  const r = await hg(`/api/billing/v1/subscriptions/${encodeURIComponent(subscriptionId)}/renew`, { method: "POST", json: {} });
  if (!r.ok) return { ok: false, message: messageOf(r) };
  try {
    const j = JSON.parse(r.body) as { status?: string; total?: number };
    const status = j.status ?? (r.status === 202 ? "payment_initiated" : "unknown");
    return {
      ok: true,
      pending: r.status === 202 || status !== "completed",
      orderStatus: status,
      totalCents: typeof j.total === "number" ? j.total : null,
    };
  } catch {
    return { ok: true, pending: true, orderStatus: "unknown", totalCents: null };
  }
}

// DNS zone ------------------------------------------------------------------

export interface HostingerZoneRecord {
  /** "@" for the apex */
  name: string;
  type: string;
  ttl: number;
  records: { content: string; is_disabled?: boolean }[];
}

export async function getHostingerZone(domain: string): Promise<HostingerZoneRecord[] | null> {
  const r = await hg(`/api/dns/v1/zones/${enc(domain)}`, { method: "GET" });
  if (!r.ok) return null;
  try {
    const arr = JSON.parse(r.body) as HostingerZoneRecord[];
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

/** Replace (overwrite) the record sets that share a name + type with the given ones. */
export async function putHostingerZone(
  domain: string,
  zone: { name: string; type: string; ttl: number; records: { content: string }[] }[],
): Promise<Done> {
  return done(await hg(`/api/dns/v1/zones/${enc(domain)}`, { method: "PUT", json: { overwrite: true, zone } }));
}

/** Remove whole record sets (every record of that name + type). */
export async function deleteHostingerZoneRecords(domain: string, filters: { name: string; type: string }[]): Promise<Done> {
  return done(await hg(`/api/dns/v1/zones/${enc(domain)}`, { method: "DELETE", json: { filters } }));
}

/** Back to Hostinger's default records — email (MX/TXT) records are kept. */
export async function resetHostingerZone(domain: string): Promise<Done> {
  return done(
    await hg(`/api/dns/v1/zones/${enc(domain)}/reset`, {
      method: "POST",
      json: { sync: true, reset_email_records: false, whitelisted_record_types: ["MX", "TXT"] },
    }),
  );
}

export interface HostingerDnsSnapshot {
  id: number;
  reason: string;
  created_at: string;
}

export async function listHostingerDnsSnapshots(domain: string): Promise<HostingerDnsSnapshot[] | null> {
  const r = await hg(`/api/dns/v1/snapshots/${enc(domain)}`, { method: "GET" });
  if (!r.ok) return null;
  try {
    const arr = JSON.parse(r.body) as HostingerDnsSnapshot[];
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

export async function restoreHostingerDnsSnapshot(domain: string, snapshotId: number): Promise<Done> {
  return done(await hg(`/api/dns/v1/snapshots/${enc(domain)}/${snapshotId}/restore`, { method: "POST", json: {} }));
}

// forwarding ----------------------------------------------------------------

export interface HostingerForwarding {
  redirectType: "301" | "302";
  redirectUrl: string;
}

/** The domain's redirect: null when it has none (Hostinger answers that with
 *  200 and empty fields), "error" when unreadable. */
export async function getHostingerForwarding(domain: string): Promise<HostingerForwarding | null | "error"> {
  const r = await hg(`/api/domains/v1/forwarding/${enc(domain)}`, { method: "GET" });
  if (r.status === 404) return null;
  if (!r.ok) return "error";
  try {
    const j = JSON.parse(r.body) as { redirect_type?: string; redirect_url?: string };
    if (!j.redirect_url || (j.redirect_type !== "301" && j.redirect_type !== "302")) return null;
    return { redirectType: j.redirect_type, redirectUrl: j.redirect_url };
  } catch {
    return "error";
  }
}

export async function setHostingerForwarding(domain: string, redirectType: "301" | "302", redirectUrl: string): Promise<Done> {
  const current = await getHostingerForwarding(domain);
  if (current === "error") return { ok: false, message: "Could not read the current forwarding" };
  const json = { redirect_type: redirectType, redirect_url: redirectUrl };
  return current
    ? done(await hg(`/api/domains/v1/forwarding/${enc(domain)}`, { method: "PUT", json }))
    : done(await hg("/api/domains/v1/forwarding", { method: "POST", json: { domain: domain.toLowerCase(), ...json } }));
}

export async function deleteHostingerForwarding(domain: string): Promise<Done> {
  return done(await hg(`/api/domains/v1/forwarding/${enc(domain)}`, { method: "DELETE" }));
}

// moving a domain to another Hostinger account (e.g. the client's own) --------

/** Hand the domain to another Hostinger account; it changes hands once that account accepts. */
export async function startHostingerDomainMove(domain: string, newCustomerEmail: string): Promise<Done> {
  return done(
    await hg(`/api/domains/v1/move/outgoing/${enc(domain)}`, { method: "POST", json: { new_customer_email: newCustomerEmail.trim() } }),
  );
}

/** The outgoing move in progress (initiated | activating | completed), null when none, "error" when unreadable. */
export async function getHostingerDomainMove(domain: string): Promise<{ status: string; createdAt: string | null } | null | "error"> {
  const r = await hg(`/api/domains/v1/move/outgoing/${enc(domain)}`, { method: "GET" });
  if (r.status === 404) return null;
  if (!r.ok) return "error";
  try {
    const j = JSON.parse(r.body) as { status?: string; created_at?: string };
    return j.status ? { status: j.status, createdAt: j.created_at ?? null } : null;
  } catch {
    return "error";
  }
}

export async function cancelHostingerDomainMove(domain: string): Promise<Done> {
  return done(await hg(`/api/domains/v1/move/outgoing/${enc(domain)}`, { method: "DELETE" }));
}
