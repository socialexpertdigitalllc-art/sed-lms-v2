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
/**
 * Subdomain creation is PROVISIONING, not a config write: DA builds the vhost
 * and issues the certificate before it answers, which the header note above
 * measures at 30-60s on this server. Under the shared 30s budget the slow half
 * of those calls aborted mid-provision — the deploy reported "This operation
 * was aborted" while DA went on to create the subdomain anyway, orphaning it
 * (seen in prod 2026-08-27 and 2026-08-31; two dead subdomains left behind).
 * `lib/site-studio/deploy/ensureSubdomain.ts` covers whatever still slips past.
 */
const CREATE_SUBDOMAIN_TIMEOUT_MS = 180000;

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
  opts?: { method?: "GET" | "POST"; timeoutMs?: number }
): Promise<DaResult> {
  const method = opts?.method ?? "GET";
  const query = new URLSearchParams(params).toString();
  const url = `${host()}/${cmd}${query ? `?${query}` : ""}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? CALL_TIMEOUT_MS);
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
  return daCall(
    "CMD_API_SUBDOMAINS",
    {
      action: "create", // NOT "add" — this build rejects it
      domain: process.env.DA_DOMAIN ?? "",
      subdomain: sub,
    },
    { timeoutMs: CREATE_SUBDOMAIN_TIMEOUT_MS }
  );
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

/**
 * Ensure a wildcard A record (*.DA_DOMAIN -> the apex's own IP) exists in the
 * zone. Without it every new subdomain waits on per-record DNS propagation —
 * minutes of "site not found" after a deploy/shuffle even though the vhost is
 * already live. Idempotent and fail-soft; returns what it did.
 */
export async function ensureWildcardDns(): Promise<"exists" | "added" | "failed"> {
  const domain = process.env.DA_DOMAIN ?? "";
  const zone = await daCall("CMD_API_DNS_CONTROL", { domain, json: "yes" });
  if (zone.error) return "failed";
  let apexIp: string | null = null;
  try {
    const parsed = JSON.parse(zone.raw) as { records?: { type?: string; name?: string; value?: string }[] };
    const records = parsed.records ?? [];
    if (records.some((r) => r.type === "A" && r.name === "*")) return "exists";
    apexIp = records.find((r) => r.type === "A" && (r.name === domain + "." || r.name === "" || r.name === "@"))?.value ?? null;
  } catch {
    return "failed";
  }
  if (!apexIp) return "failed";
  const added = await daCall("CMD_API_DNS_CONTROL", {
    domain,
    action: "add",
    type: "A",
    name: "*",
    value: apexIp,
  });
  return added.error ? "failed" : "added";
}

/** All subdomain labels on DA_DOMAIN. Null when the listing itself fails (never []). */
export async function listSubdomains(): Promise<string[] | null> {
  const res = await daCall("CMD_API_SUBDOMAINS", { domain: process.env.DA_DOMAIN ?? "" });
  if (res.error) return null;
  try {
    return new URLSearchParams(res.raw.trim()).getAll("list[]").filter(Boolean);
  } catch {
    return null;
  }
}

export async function subdomainExists(sub: string): Promise<boolean> {
  const list = await listSubdomains();
  return list !== null && list.includes(sub);
}

interface JsonCallResult {
  ok: boolean;
  status: number;
  body: string;
}

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

/** Modern /api/* call. Non-throwing; body is the raw response text ("" on 204).
 *  Its timeout covers the whole exchange; `signal` stops it early. */
async function daJson(
  pathAndQuery: string,
  init: { method: "GET" | "POST" | "DELETE"; json?: unknown; form?: FormData; timeoutMs?: number; signal?: AbortSignal }
): Promise<JsonCallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? CALL_TIMEOUT_MS);
  const unfollow = followSignal(controller, init.signal);
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
    unfollow();
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

// ---------------------------------------------------------------------------
// single files (SED CMS publishing). Paths are relative to the subdomain's
// docroot and are checked by the caller (lib/sedcms/paths.ts). Every call
// here has its own 30 s, through an AbortSignal; reads and listings also stop
// when the caller's signal aborts (SED CMS's deadline).

/** listDir's page size: a listing this long may be cut, so it isn't trusted. */
const LIST_LIMIT = 1000;
/** One single-file call, its whole exchange. */
const SINGLE_FILE_TIMEOUT_MS = 30000;

const inDocroot = (sub: string, rel: string) => (rel ? `${docrootFor(sub)}/${rel}` : docrootFor(sub));

export interface DocrootEntry {
  name: string;
  /** "other": a link or anything else, never followed. */
  kind: "file" | "dir" | "other";
  size: number | null;
}

function entryKind(f: Record<string, unknown>): DocrootEntry["kind"] {
  const type = typeof f.type === "string" ? f.type.toLowerCase() : "";
  if (type.includes("link") || f.isLink === true || f.isSymlink === true) return "other";
  if (type === "dir" || type === "directory" || type === "folder" || f.isDir === true) return "dir";
  if (type === "file" || type === "regular") return "file";
  return "other";
}

/**
 * The entries directly inside one folder of a subdomain's docroot ("" = the
 * docroot) — the file manager listing clearDocroot already uses, with sizes.
 * null when it can't be listed, or when the listing may have been cut short.
 */
export async function listDocrootDir(sub: string, relDir: string, opts: { signal?: AbortSignal } = {}): Promise<DocrootEntry[] | null> {
  return listDaFolder(inDocroot(sub, relDir), opts);
}

/** The same listing, for any folder of the account by its absolute path. */
export async function listDaFolder(absPath: string, opts: { signal?: AbortSignal } = {}): Promise<DocrootEntry[] | null> {
  const q = new URLSearchParams({ path: absPath, limit: String(LIST_LIMIT) }).toString();
  const r = await daJson(`/api/filemanager/list?${q}`, { method: "GET", timeoutMs: SINGLE_FILE_TIMEOUT_MS, signal: opts.signal });
  if (!r.ok) return null;
  try {
    const j = JSON.parse(r.body) as { files?: Record<string, unknown>[] };
    if (!Array.isArray(j.files) || j.files.length >= LIST_LIMIT) return null;
    return j.files.map((f) => {
      const size = typeof f.size === "number" ? f.size : typeof f.size === "string" && /^[0-9]+$/.test(f.size) ? Number(f.size) : NaN;
      return {
        name: typeof f.name === "string" ? f.name : "",
        kind: entryKind(f),
        size: Number.isFinite(size) && size >= 0 ? size : null,
      };
    });
  } catch {
    return null;
  }
}

/**
 * One file's bytes from a subdomain's docroot. null when DirectAdmin answers
 * 404. Refused past maxBytes while streaming.
 *
 * UNVERIFIED — the one call the live spike must confirm (launch plan L2 and
 * open question 1): GET /api/filemanager/download?path=<absolute path>, the
 * single-file sibling of the verified download-archive. DirectAdmin's OpenAPI
 * spec lists GET /api/filemanager/download; the spike confirms its `path`
 * parameter and that the bytes are exact. If not, this function alone changes
 * (the fallback is the staging host's public HTTPS URL; there is no CDN on
 * staging). Callers
 * check the result's length against the listing, so a 200 carrying one of
 * DirectAdmin's error bodies is never taken for the file.
 */
export async function readDocrootFile(
  sub: string,
  relPath: string,
  maxBytes: number,
  opts: { signal?: AbortSignal } = {},
): Promise<{ ok: true; bytes: Uint8Array | null } | { ok: false; tooLarge: boolean; message: string }> {
  const q = new URLSearchParams({ path: inDocroot(sub, relPath) }).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SINGLE_FILE_TIMEOUT_MS);
  const unfollow = followSignal(controller, opts.signal);
  try {
    const res = await fetch(`${host()}/api/filemanager/download?${q}`, {
      method: "GET",
      headers: { Authorization: authHeader() },
      signal: controller.signal,
    });
    if (res.status === 404) {
      await res.body?.cancel().catch(() => {});
      return { ok: true, bytes: null };
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, tooLarge: false, message: `HTTP ${res.status}` };
    }
    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, tooLarge: true, message: `larger than ${maxBytes} bytes` };
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
          return { ok: false, tooLarge: true, message: `larger than ${maxBytes} bytes` };
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
    return { ok: true, bytes };
  } catch (e) {
    return {
      ok: false,
      tooLarge: false,
      message: opts.signal?.aborted
        ? "stopped by the caller"
        : controller.signal.aborted
          ? `no answer within ${SINGLE_FILE_TIMEOUT_MS / 1000}s`
          : e instanceof Error
            ? e.message
            : "network error",
    };
  } finally {
    clearTimeout(timer);
    unfollow();
  }
}

// SED CMS never writes a live file in place. A write uploads the bytes to a
// temporary file (uploadDaFile, normally in the subdomain's own folder, next
// to its public_html: outside the web root), checks it (listDaFolder), and
// replaces the live file in ONE move (moveDaFile). A missing folder is made
// first, level by level (makeDaFolder), which writes no file.
//
// The shapes follow DirectAdmin's OpenAPI spec (its /static/swagger.json):
// paths are chrooted to the user's home; move takes { source, destination,
// overwrite } (all required) and answers 204, or 409 FilemanagerOpError;
// mkdir takes { path }; remove takes { paths, trash } (both required).

/** The folder that holds a subdomain's public_html: outside its web root. */
export function siteFolderFor(sub: string): string {
  return `/domains/${sub}.${process.env.DA_DOMAIN ?? ""}`;
}

type DaStep = { ok: true } | { ok: false; message: string };

/** Upload bytes as absDir/name, replacing one of that name (the verified
 *  upload, `dir` param). 30 s. Only ever a temporary file of SED CMS's. */
export async function uploadDaFile(absDir: string, name: string, bytes: Uint8Array, type = "application/octet-stream"): Promise<DaStep> {
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array(bytes)], name, { type }));
  const q = new URLSearchParams({ dir: absDir, name, overwrite: "true" }).toString();
  const r = await daJson(`/api/filemanager-actions/upload?${q}`, { method: "POST", form: fd, timeoutMs: SINGLE_FILE_TIMEOUT_MS });
  return r.ok ? { ok: true } : { ok: false, message: `upload: ${jsonErrorMessage(r)}` };
}

/**
 * Replace `toAbs` with `fromAbs` in ONE call: POST
 * /api/filemanager-actions/move { source, destination, overwrite: true }, as
 * DirectAdmin's spec documents it. 204 is success; a 409 FilemanagerOpError
 * (or anything else) is a failed move. 30 s; never retried.
 *
 * The live spike must confirm it is one rename(2) — the old file replaced
 * whole, never deleted first or copied in place.
 */
export async function moveDaFile(fromAbs: string, toAbs: string): Promise<DaStep> {
  const r = await daJson("/api/filemanager-actions/move", {
    method: "POST",
    json: { source: fromAbs, destination: toAbs, overwrite: true },
    timeoutMs: SINGLE_FILE_TIMEOUT_MS,
  });
  return r.ok ? { ok: true } : { ok: false, message: `move: ${jsonErrorMessage(r)}` };
}

/**
 * Make one folder: POST /api/filemanager-actions/mkdir { path }. 30 s. One
 * level at a time (the spec doesn't say it makes parents). A folder that is
 * already there is an error here; the caller confirms it with a listing.
 */
export async function makeDaFolder(absPath: string): Promise<DaStep> {
  const r = await daJson("/api/filemanager-actions/mkdir", { method: "POST", json: { path: absPath }, timeoutMs: SINGLE_FILE_TIMEOUT_MS });
  return r.ok ? { ok: true } : { ok: false, message: `mkdir: ${jsonErrorMessage(r)}` };
}

/**
 * Remove SED CMS's own temporary files for good: POST
 * /api/filemanager-actions/remove { paths, trash: false } — both fields are
 * required by the spec, and trash: false removes permanently. 30 s.
 * (removePaths, used by the deploy flows, sends { paths } alone.)
 */
export async function removeDaPaths(paths: string[]): Promise<DaStep> {
  if (paths.length === 0) return { ok: true };
  const r = await daJson("/api/filemanager-actions/remove", { method: "POST", json: { paths, trash: false }, timeoutMs: SINGLE_FILE_TIMEOUT_MS });
  return r.ok ? { ok: true } : { ok: false, message: `remove: ${jsonErrorMessage(r)}` };
}
