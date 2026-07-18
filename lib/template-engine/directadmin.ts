/**
 * DirectAdmin client for site deploys (Basic auth: user + login key).
 * Env: DA_HOST (e.g. https://server:2222), DA_USERNAME, DA_LOGIN_KEY, DA_DOMAIN.
 *
 * Every call below was VERIFIED live against the production server
 * (da900.is.cc, 2026-07-18) — see docs/superpowers/specs/2026-07-18-deployment-
 * system-design.md. The load-bearing quirks of this DA build:
 *   - subdomain creation is `action=create` (`action=add` fails "no action included");
 *   - each subdomain owns its own tree: /domains/{sub}.{DA_DOMAIN}/public_html
 *     (NOT a folder under the parent domain's public_html);
 *   - file upload goes through the modern JSON API
 *     POST /api/filemanager-actions/upload?dir=...&name=...&overwrite=true with
 *     multipart field `file` — the legacy CMD_FILE_MANAGER upload 500s, and the
 *     modern endpoint silently ignores a `path` param (files land in the home
 *     root), so the param MUST be `dir`;
 *   - extraction is POST /api/filemanager-actions/extract-archive with JSON
 *     {source, destinationDir, members, mergeAndOverwrite};
 *   - HTTPS is automatic: a cert is issued ~30-60s after creation, after which
 *     http 301s to https. Verification must poll patiently, never assume.
 *
 * All calls are non-throwing and carry timeouts — a stalled connection must
 * surface as an error, not hang a deploy.
 */

export interface DaResult {
  error: boolean;
  text: string;
  details: string;
  raw: string;
}

const CALL_TIMEOUT_MS = 30000;
const UPLOAD_TIMEOUT_MS = 120000; // site zips are small (<1MB) but allow slow links

export function daConfigured(): boolean {
  return Boolean(
    process.env.DA_HOST && process.env.DA_USERNAME && process.env.DA_LOGIN_KEY && process.env.DA_DOMAIN
  );
}

const host = () => (process.env.DA_HOST ?? "").replace(/\/+$/, "");
const authHeader = () =>
  "Basic " + Buffer.from(`${process.env.DA_USERNAME ?? ""}:${process.env.DA_LOGIN_KEY ?? ""}`).toString("base64");

/** The docroot of a client-site subdomain on THIS server's layout. */
export function docrootFor(sub: string): string {
  return `/domains/${sub}.${process.env.DA_DOMAIN ?? ""}/public_html`;
}

/**
 * Recover the subdomain from a lead's website_link when it points at one of
 * our client sites (https://{sub}.{daDomain}/...). Null for anything else —
 * external domains, the bare domain, nested subdomains, or unparseable input.
 * Pure; used to keep redeploys landing on the SAME subdomain.
 */
export function subFromWebsiteLink(link: string | null | undefined, daDomain: string): string | null {
  if (!link) return null;
  let hostname: string;
  try {
    hostname = new URL(link).hostname.toLowerCase();
  } catch {
    return null;
  }
  const suffix = `.${daDomain.toLowerCase()}`;
  if (!hostname.endsWith(suffix)) return null;
  const sub = hostname.slice(0, -suffix.length);
  if (!sub || sub.includes(".")) return null; // bare domain or nested — not a client site
  return sub;
}

export function parseDaResponse(text: string): { error: boolean; text: string; details: string } {
  const body = (text ?? "").trim();

  if (body.startsWith("{") || body.startsWith("[")) {
    try {
      const json = JSON.parse(body) as unknown;
      if (json && typeof json === "object" && !Array.isArray(json)) {
        const rec = json as Record<string, unknown>;
        const err = rec.error;
        return {
          error: err === 1 || err === true || err === "1",
          text: typeof rec.text === "string" ? rec.text : typeof rec.message === "string" ? rec.message : "",
          details: typeof rec.details === "string" ? rec.details : "",
        };
      }
    } catch {
      // fall through to url-encoded parsing
    }
  }

  const params = new URLSearchParams(body);
  const err = params.get("error");
  return {
    error: err !== null && err !== "" && err !== "0",
    text: params.get("text") ?? "",
    details: params.get("details") ?? "",
  };
}

/** Legacy CMD_* call: params in the query string (the form this build parses reliably). */
export async function daCall(
  cmd: string,
  params: Record<string, string>,
  opts?: { method?: "GET" | "POST" }
): Promise<DaResult> {
  const method = opts?.method ?? "GET";
  const query = new URLSearchParams(params).toString();
  const url = `${host()}/${cmd}${query ? `?${query}` : ""}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method, headers: { Authorization: authHeader() }, signal: controller.signal });
    const raw = await res.text();
    const parsed = parseDaResponse(raw);
    return { ...parsed, error: parsed.error || !res.ok, raw };
  } catch (e) {
    return { error: true, text: e instanceof Error ? e.message : "network error", details: "", raw: "" };
  } finally {
    clearTimeout(timer);
  }
}

export async function createSubdomain(sub: string): Promise<DaResult> {
  return daCall("CMD_API_SUBDOMAINS", {
    action: "create", // NOT "add" — this build rejects it
    domain: process.env.DA_DOMAIN ?? "",
    subdomain: sub,
  });
}

/** Delete the subdomain AND its directory tree (take-down / failed-deploy cleanup). */
export async function deleteSubdomain(sub: string): Promise<DaResult> {
  return daCall("CMD_API_SUBDOMAINS", {
    action: "delete",
    domain: process.env.DA_DOMAIN ?? "",
    select0: sub,
    contents: "yes",
  });
}

export async function subdomainExists(sub: string): Promise<boolean> {
  const res = await daCall("CMD_API_SUBDOMAINS", { domain: process.env.DA_DOMAIN ?? "" });
  if (res.error) return false;
  try {
    return new URLSearchParams(res.raw.trim()).getAll("list[]").includes(sub);
  } catch {
    return false;
  }
}

interface JsonCallResult {
  ok: boolean;
  status: number;
  body: string;
}

/** Modern /api/* call. Non-throwing; body is the raw response text ("" on 204). */
async function daJson(
  pathAndQuery: string,
  init: { method: "GET" | "POST" | "DELETE"; json?: unknown; form?: FormData; timeoutMs?: number }
): Promise<JsonCallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? CALL_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { Authorization: authHeader() };
    let body: BodyInit | undefined;
    if (init.form) {
      body = init.form; // runtime sets the multipart boundary content-type
    } else if (init.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.json);
    }
    const res = await fetch(`${host()}${pathAndQuery}`, { method: init.method, headers, body, signal: controller.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text };
  } catch (e) {
    return { ok: false, status: 0, body: e instanceof Error ? e.message : "network error" };
  } finally {
    clearTimeout(timer);
  }
}

/** Short human message out of a modern-API error body. */
function jsonErrorMessage(r: JsonCallResult): string {
  try {
    const j = JSON.parse(r.body) as { message?: string; type?: string; errors?: { path?: string; reason?: string }[] };
    if (j.message) return j.message;
    if (Array.isArray(j.errors) && j.errors.length) {
      return j.errors.map((e) => `${e.path ?? ""}: ${e.reason ?? "error"}`).join("; ");
    }
  } catch {
    // not json
  }
  return r.body ? r.body.slice(0, 200) : `HTTP ${r.status}`;
}

/**
 * Download a subdomain's docroot as a zip, STRAIGHT FROM the live DirectAdmin
 * files — the source of truth for a transfer, so any manual edits the operator
 * uploaded to the subdomain after generation are captured (not the stale
 * generator zip). Returns the zip bytes, or null on failure. Never throws.
 */
export async function archiveDocroot(sub: string): Promise<Uint8Array | null> {
  const q = new URLSearchParams({ path: docrootFor(sub), type: "zip" }).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(`${host()}/api/filemanager/download-archive?${q}`, {
      method: "GET",
      headers: { Authorization: authHeader() },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    // A DA error can come back 200 with a tiny HTML/text body instead of a zip;
    // a real site archive is never a few bytes. Guard against shipping that.
    if (buf.length < 100 || buf[0] !== 0x50 || buf[1] !== 0x4b) return null; // "PK" zip magic
    return buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** List a directory via the modern API. Returns null when the listing fails. */
export async function listDir(path: string): Promise<{ name: string; type: string }[] | null> {
  const q = new URLSearchParams({ path, limit: "1000" }).toString();
  const r = await daJson(`/api/filemanager/list?${q}`, { method: "GET" });
  if (!r.ok) return null;
  try {
    const j = JSON.parse(r.body) as { files?: { name?: string; type?: string }[] };
    return (j.files ?? []).map((f) => ({ name: String(f.name ?? ""), type: String(f.type ?? "") }));
  } catch {
    return null;
  }
}

/** Remove files/directories (recursive) via the modern API. */
export async function removePaths(paths: string[]): Promise<{ ok: boolean; message?: string }> {
  if (paths.length === 0) return { ok: true };
  const r = await daJson("/api/filemanager-actions/remove", { method: "POST", json: { paths } });
  return r.ok ? { ok: true } : { ok: false, message: jsonErrorMessage(r) };
}

// The one docroot entry DirectAdmin owns; everything else in a client-site
// docroot is ours to replace on redeploy.
const PROTECTED_DOCROOT_ENTRIES = new Set(["cgi-bin"]);

/**
 * Empty a subdomain's docroot for an in-place redeploy, so pages removed by a
 * regeneration never linger on the live site. Fails loudly when the listing
 * fails — never blind-deploy onto unknown contents.
 */
export async function clearDocroot(sub: string): Promise<{ ok: boolean; message?: string }> {
  const dir = docrootFor(sub);
  const entries = await listDir(dir);
  if (entries === null) return { ok: false, message: `could not list ${dir}` };
  const doomed = entries
    .filter((e) => e.name && !PROTECTED_DOCROOT_ENTRIES.has(e.name))
    .map((e) => `${dir}/${e.name}`);
  return removePaths(doomed);
}

/**
 * Upload a site zip into the subdomain docroot, extract it there, then delete
 * the zip. failedStep "delete" means the site is live and only zip cleanup
 * failed (non-fatal for callers).
 */
export async function uploadZipAndExtract(
  sub: string,
  zipBytes: Uint8Array,
  zipName: string
): Promise<{ ok: boolean; failedStep?: "upload" | "extract" | "delete"; message?: string }> {
  const dir = docrootFor(sub);
  const zipPath = `${dir}/${zipName}`;

  const fd = new FormData();
  // copy so the BlobPart is backed by a plain ArrayBuffer (TS: Uint8Array<ArrayBufferLike> is not a BlobPart)
  fd.append("file", new File([new Uint8Array(zipBytes)], zipName, { type: "application/zip" }));
  const q = new URLSearchParams({ dir, name: zipName, overwrite: "true" }).toString();
  const upload = await daJson(`/api/filemanager-actions/upload?${q}`, {
    method: "POST",
    form: fd,
    timeoutMs: UPLOAD_TIMEOUT_MS,
  });
  if (!upload.ok) {
    return { ok: false, failedStep: "upload", message: jsonErrorMessage(upload) };
  }

  const extract = await daJson("/api/filemanager-actions/extract-archive", {
    method: "POST",
    json: { source: zipPath, destinationDir: dir, members: [], mergeAndOverwrite: true },
    timeoutMs: UPLOAD_TIMEOUT_MS,
  });
  if (!extract.ok) {
    return { ok: false, failedStep: "extract", message: jsonErrorMessage(extract) };
  }

  const del = await removePaths([zipPath]);
  if (!del.ok) {
    return { ok: false, failedStep: "delete", message: del.message };
  }

  return { ok: true };
}
