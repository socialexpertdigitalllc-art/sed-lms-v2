import { vi } from "vitest";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";

/**
 * In-memory stand-ins for the two hosts a client site lives on, served
 * through a stubbed global fetch, for the SED CMS single-file tests:
 *   - Hostinger: the websites lookup, the upload-URL credentials, and the
 *     File Browser behind them: resources (folder listing, file info with
 *     ?checksum=sha256, rename with override, delete, make a folder), raw
 *     reads, and TUS uploads — whose create, with override=true, empties an
 *     existing file at once, as filebrowser's does;
 *   - DirectAdmin: the file manager's list, single-file download, upload,
 *     extract-archive, remove and move.
 * Each host has its own little filesystem of absolute paths. Every request is
 * recorded, with the paths it actually changed, so a test can assert what
 * was (or wasn't) called and touched.
 */

export const HG_API = "https://developers.hostinger.com";
export const HG_FILES = "https://srv955-files.hstgr.io/rest/abc123";
export const DA_HOST = "https://da900.example.test:2222";
export const DA_DOMAIN = "dmviral.com";

export class MemFs {
  readonly files = new Map<string, Uint8Array>();
  /** absolute paths listed as symbolic links */
  readonly links = new Set<string>();
  readonly emptyDirs = new Set<string>();
  /** absolute path -> the size the listing reports instead of the real one */
  readonly listedSize = new Map<string, number>();

  put(abs: string, content: string | Uint8Array) {
    this.files.set(abs, typeof content === "string" ? new TextEncoder().encode(content) : content);
  }

  text(abs: string): string | null {
    const b = this.files.get(abs);
    return b ? new TextDecoder().decode(b) : null;
  }

  isDir(abs: string): boolean {
    const dir = abs.replace(/[/]+$/, "");
    if (dir === "") return true; // the root
    const prefix = `${dir}/`;
    if (this.emptyDirs.has(dir)) return true;
    for (const k of this.files.keys()) if (k.startsWith(prefix)) return true;
    for (const k of this.links) if (k.startsWith(prefix)) return true;
    for (const k of this.emptyDirs) if (k.startsWith(prefix)) return true;
    return false;
  }

  /** Every path that looks like one of SED CMS's temporary files. */
  temps(): string[] {
    return [...this.files.keys()].filter((k) => /[/][.]?sedcms-[^/]*$/.test(k));
  }

  children(absDir: string): { name: string; kind: "file" | "dir" | "link"; size: number }[] {
    const prefix = `${absDir.replace(/[/]+$/, "")}/`;
    const out = new Map<string, { name: string; kind: "file" | "dir" | "link"; size: number }>();
    const visit = (key: string, kind: "file" | "link", size: number) => {
      if (!key.startsWith(prefix)) return;
      const rest = key.slice(prefix.length);
      const name = rest.split("/")[0];
      if (rest.includes("/")) out.set(name, { name, kind: "dir", size: 4096 });
      else out.set(name, { name, kind, size });
    };
    for (const [k, v] of this.files) visit(k, "file", this.listedSize.get(k) ?? v.length);
    for (const k of this.links) visit(k, "link", 12);
    for (const k of this.emptyDirs) {
      if (k.startsWith(prefix)) out.set(k.slice(prefix.length).split("/")[0], { name: k.slice(prefix.length).split("/")[0], kind: "dir", size: 4096 });
    }
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Remove a file, or a folder and everything in it. */
  remove(abs: string): boolean {
    const prefix = `${abs}/`;
    let found = this.files.delete(abs);
    for (const k of [...this.files.keys()]) if (k.startsWith(prefix)) found = this.files.delete(k) || found;
    for (const k of [...this.emptyDirs]) if (k === abs || k.startsWith(prefix)) found = this.emptyDirs.delete(k) || found;
    return found;
  }
}

export interface RecordedCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  /** Date.now() when the call was made (the fake clock under fake timers) */
  at: number;
  /** the paths this call changed (written, emptied, moved, removed, made) */
  changed: string[];
}

export interface HostingerWebsiteFake {
  domain: string;
  username: string;
  website_type?: string | null;
  root_directory?: string;
}

export interface FakeHostsOptions {
  websites?: HostingerWebsiteFake[];
  /** the websites lookup fails (HTTP 500) */
  hostingerDown?: boolean;
  /** upload-urls answers 409: the website is still being set up */
  hostingerPending?: boolean;
  /** raw reads stream in chunks of this many bytes, with no content-length */
  chunkBytes?: number;
  /** answer this path's raw read / download with a body of a different size than listed */
  shortRead?: string;
  /** answer this call with a 500, changing nothing */
  fail?: (call: RecordedCall) => boolean;
  /** answer this call with this response instead, changing nothing */
  answer?: (call: RecordedCall) => Response | undefined;
  /** what a file-info answer or a listing says about this path instead of the truth */
  misreport?: (abs: string) => { size?: number; sha256?: string } | undefined;
  /** answer this call only after this many ms (setTimeout, so fake timers drive it); aborting the call's signal ends the wait, as with a real fetch */
  delay?: (call: RecordedCall) => number;
  /** never answer this call: it ends only when its signal aborts, as a real fetch would */
  hang?: (call: RecordedCall) => boolean;
}

export interface FakeHosts {
  hostinger: MemFs;
  da: MemFs;
  calls: RecordedCall[];
  /** raw/download chunks actually pulled by the client */
  chunksPulled: number;
  /** how many chunks a streaming body had to offer */
  chunksOffered: number;
}

function headersOf(init?: RequestInit): Record<string, string> {
  const h = new Headers(init?.headers);
  const out: Record<string, string> = {};
  h.forEach((v, k) => (out[k] = v));
  return out;
}

function streamed(bytes: Uint8Array, chunk: number, state: FakeHosts): Response {
  let offset = 0;
  state.chunksOffered += Math.ceil(bytes.length / chunk);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      state.chunksPulled++;
      controller.enqueue(bytes.slice(offset, offset + chunk));
      offset += chunk;
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "application/octet-stream" } });
}

const abortError = () => new DOMException("This operation was aborted", "AbortError");

/** Waits ms (forever when ms is Infinity); rejects like fetch when the signal aborts. */
function wait(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = Number.isFinite(ms) ? setTimeout(resolve, ms) : null;
    signal?.addEventListener(
      "abort",
      () => {
        if (timer) clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

async function bodyBytes(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (typeof body === "string") return new TextEncoder().encode(body);
  return new Uint8Array();
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const parentOf = (abs: string) => abs.slice(0, abs.lastIndexOf("/"));

export const HG_ROOT = "/public_html";
export const daDocroot = (sub: string) => `/domains/${sub}.${DA_DOMAIN}/public_html`;
export const daSiteFolder = (sub: string) => `/domains/${sub}.${DA_DOMAIN}`;

/** Stubs global fetch with both fake hosts. Call vi.unstubAllGlobals() after. */
export function installFakeHosts(opts: FakeHostsOptions = {}): FakeHosts {
  const state: FakeHosts = { hostinger: new MemFs(), da: new MemFs(), calls: [], chunksPulled: 0, chunksOffered: 0 };
  const chunk = opts.chunkBytes ?? 64 * 1024;
  const tus = new Map<string, number>();

  const handler = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = headersOf(init);
    const call: RecordedCall = { method, url: url.toString(), headers, body: init?.body, at: Date.now(), changed: [] };
    state.calls.push(call);
    if (opts.hang?.(call)) await wait(Infinity, init?.signal);
    const delay = opts.delay?.(call) ?? 0;
    if (delay > 0) await wait(delay, init?.signal);
    if (opts.fail?.(call)) return new Response("the host failed", { status: 500 });
    const answered = opts.answer?.(call);
    if (answered) return answered;

    // ---- Hostinger API
    if (url.origin === HG_API) {
      if (headers.authorization !== "Bearer test-token") return new Response("no", { status: 401 });
      if (url.pathname === "/api/hosting/v1/websites" && method === "GET") {
        if (opts.hostingerDown) return new Response("boom", { status: 500 });
        const d = (url.searchParams.get("domain") ?? "").toLowerCase();
        const data = (opts.websites ?? [])
          .filter((w) => w.domain.includes(d))
          .map((w) => ({ root_directory: "/home/u/domains/x/public_html", vhost_type: "addon", order_id: 1, is_enabled: true, website_type: "other", ...w }));
        return Response.json({ data, meta: { current_page: 1, per_page: 100, total: data.length } });
      }
      if (url.pathname === "/api/hosting/v1/files/upload-urls" && method === "POST") {
        if (opts.hostingerPending) return new Response(JSON.stringify({ message: "setting up" }), { status: 409 });
        return Response.json({ url: `${HG_FILES}/api/tus/public_html`, auth_key: "AK", rest_auth_key: "RK" });
      }
      throw new Error(`unexpected Hostinger API call: ${method} ${url}`);
    }

    // ---- Hostinger File Browser (filebrowser's API)
    if (url.origin === new URL(HG_FILES).origin && url.pathname.startsWith(new URL(HG_FILES).pathname)) {
      if (headers["x-auth"] !== "AK" || headers["x-auth-rest"] !== "RK") return new Response("no", { status: 401 });
      const rest = decodeURIComponent(url.pathname.slice(new URL(HG_FILES).pathname.length));
      const fs = state.hostinger;

      if (rest.startsWith("/api/resources/")) {
        const raw = rest.slice("/api/resources".length);
        const abs = raw.replace(/[/]+$/, "");
        if (method === "GET") {
          if (fs.isDir(abs)) {
            const items = fs.children(abs).map((c) => ({
              path: `${abs}/${c.name}`,
              name: c.name,
              size: opts.misreport?.(`${abs}/${c.name}`)?.size ?? c.size,
              isDir: c.kind === "dir",
              isSymlink: c.kind === "link",
              type: c.kind === "dir" ? "" : "text",
            }));
            return Response.json({ items, isDir: true, path: abs });
          }
          const bytes = fs.files.get(abs);
          if (!bytes) return new Response("404 Not Found", { status: 404 });
          const lie = opts.misreport?.(abs);
          const info: Record<string, unknown> = { path: abs, name: abs.slice(abs.lastIndexOf("/") + 1), size: lie?.size ?? bytes.length, isDir: false, type: "blob" };
          if (url.searchParams.get("checksum") === "sha256") info.checksums = { sha256: lie?.sha256 ?? sha256(bytes) };
          return Response.json(info);
        }
        if (method === "POST" && raw.endsWith("/")) {
          // filebrowser: a POST to a path ending in "/" makes the folder (MkdirAll)
          fs.emptyDirs.add(abs);
          call.changed.push(abs);
          return new Response(null, { status: 200 });
        }
        if (method === "PATCH" && url.searchParams.get("action") === "rename") {
          const dst = decodeURIComponent(url.searchParams.get("destination") ?? "");
          const bytes = fs.files.get(abs);
          if (!bytes) return new Response("404 Not Found", { status: 404 });
          if (fs.files.has(dst) && url.searchParams.get("override") !== "true") return new Response("409 Conflict", { status: 409 });
          if (!fs.isDir(parentOf(dst))) return new Response("500 rename: no such file or directory", { status: 500 });
          fs.files.set(dst, bytes); // one rename(2): the old file is replaced whole
          fs.files.delete(abs);
          call.changed.push(abs, dst);
          return new Response(null, { status: 200 });
        }
        if (method === "DELETE") {
          if (!fs.remove(abs)) return new Response("404 Not Found", { status: 404 });
          call.changed.push(abs);
          return new Response(null, { status: 200 });
        }
      }
      if (rest.startsWith("/api/raw/") && method === "GET") {
        const abs = rest.slice("/api/raw".length);
        if (fs.isDir(abs)) return new Response(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), { status: 200 }); // a directory comes back zipped
        const bytes = fs.files.get(abs);
        if (!bytes) return new Response("404 Not Found", { status: 404 });
        if (opts.shortRead && abs.endsWith(`/${opts.shortRead}`)) return new Response(bytes.slice(0, Math.max(0, bytes.length - 1)));
        return streamed(bytes, chunk, state);
      }
      if (rest.startsWith("/api/tus/")) {
        const abs = rest.slice("/api/tus".length);
        if (url.searchParams.get("override") !== "true" && fs.files.has(abs)) return new Response("conflict", { status: 409 });
        if (headers["tus-resumable"] !== "1.0.0") return new Response("tus?", { status: 412 });
        if (method === "POST") {
          // filebrowser opens the target with O_CREATE|O_TRUNC under override=true: an existing file is emptied now
          tus.set(abs, Number(headers["upload-length"]));
          fs.put(abs, new Uint8Array());
          call.changed.push(abs);
          return new Response(null, { status: 201 });
        }
        if (method === "PATCH") {
          const expected = tus.get(abs);
          const bytes = await bodyBytes(init?.body);
          if (expected === undefined || bytes.length !== expected) return new Response("length", { status: 400 });
          fs.put(abs, bytes);
          tus.delete(abs);
          call.changed.push(abs);
          return new Response(null, { status: 204, headers: { "Upload-Offset": String(bytes.length) } });
        }
      }
      throw new Error(`unexpected File Browser call: ${method} ${url}`);
    }

    // ---- DirectAdmin
    if (url.origin === DA_HOST) {
      const auth = `Basic ${Buffer.from("dauser:da-login-key").toString("base64")}`;
      if (headers.authorization !== auth) return new Response("no", { status: 401 });
      const fs = state.da;
      if (url.pathname === "/api/filemanager/list" && method === "GET") {
        const abs = (url.searchParams.get("path") ?? "").replace(/[/]+$/, "");
        if (!fs.isDir(abs)) return Response.json({ type: "error", message: "no such directory" }, { status: 404 });
        return Response.json({
          files: fs.children(abs).map((c) => ({ name: c.name, type: c.kind, size: opts.misreport?.(`${abs}/${c.name}`)?.size ?? c.size })),
        });
      }
      if (url.pathname === "/api/filemanager/download" && method === "GET") {
        const abs = url.searchParams.get("path") ?? "";
        const bytes = fs.files.get(abs);
        if (!bytes) return Response.json({ message: "not found" }, { status: 404 });
        if (opts.shortRead && abs.endsWith(`/${opts.shortRead}`)) return new Response("error=1&text=oops");
        return streamed(bytes, chunk, state);
      }
      if (url.pathname === "/api/filemanager-actions/upload" && method === "POST") {
        const dir = url.searchParams.get("dir") ?? "";
        const name = url.searchParams.get("name") ?? "";
        if (url.searchParams.get("overwrite") !== "true") return Response.json({ message: "exists" }, { status: 409 });
        if (!fs.isDir(dir)) return Response.json({ message: "no such directory" }, { status: 404 });
        const form = init?.body as FormData;
        const file = form.get("file");
        if (!(file instanceof Blob)) return Response.json({ message: "no file" }, { status: 400 });
        fs.put(`${dir}/${name}`, new Uint8Array(await file.arrayBuffer()));
        call.changed.push(`${dir}/${name}`);
        return new Response(null, { status: 204 });
      }
      // The filemanager-actions below follow DirectAdmin's OpenAPI spec: every
      // body field it marks required is required here (400 without it), and
      // an operation that can't be done is a 409 FilemanagerOpError.
      const opError = (message: string) => Response.json({ type: "FilemanagerOpError", message }, { status: 409 });
      const jsonBody = () => JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (url.pathname === "/api/filemanager-actions/extract-archive" && method === "POST") {
        const j = jsonBody();
        if (typeof j.source !== "string" || typeof j.destinationDir !== "string" || !Array.isArray(j.members) || typeof j.mergeAndOverwrite !== "boolean") {
          return Response.json({ message: "source, destinationDir, members and mergeAndOverwrite are required" }, { status: 400 });
        }
        const zip = fs.files.get(j.source);
        if (!zip || !j.mergeAndOverwrite) return opError("bad extract");
        for (const [name, data] of Object.entries(unzipSync(zip))) {
          const target = `${j.destinationDir}/${name.replace(/[/]+$/, "")}`;
          if (name.endsWith("/")) fs.emptyDirs.add(target);
          else fs.put(target, data);
          call.changed.push(target);
        }
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/api/filemanager-actions/remove" && method === "POST") {
        const j = jsonBody();
        if (!Array.isArray(j.paths) || typeof j.trash !== "boolean") return Response.json({ message: "paths and trash are required" }, { status: 400 });
        for (const p of j.paths as string[]) if (fs.remove(p)) call.changed.push(p);
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/api/filemanager-actions/mkdir" && method === "POST") {
        const j = jsonBody();
        if (typeof j.path !== "string") return Response.json({ message: "path is required" }, { status: 400 });
        const target = j.path.replace(/[/]+$/, "");
        if (fs.files.has(target) || fs.isDir(target)) return opError("already exists");
        if (!fs.isDir(parentOf(target))) return opError("no such parent directory"); // one level at a time
        fs.emptyDirs.add(target);
        call.changed.push(target);
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/api/filemanager-actions/move" && method === "POST") {
        const j = jsonBody();
        if (typeof j.source !== "string" || typeof j.destination !== "string" || typeof j.overwrite !== "boolean") {
          return Response.json({ message: "source, destination and overwrite are required" }, { status: 400 });
        }
        const bytes = fs.files.get(j.source);
        if (!bytes) return opError("no such file");
        if (fs.files.has(j.destination) && !j.overwrite) return opError("already exists");
        if (!fs.isDir(parentOf(j.destination))) return opError("no such directory");
        fs.files.set(j.destination, bytes); // one rename(2): the old file is replaced whole
        fs.files.delete(j.source);
        call.changed.push(j.source, j.destination);
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected DirectAdmin call: ${method} ${url}`);
    }

    throw new Error(`unexpected fetch: ${method} ${url}`);
  };

  vi.stubGlobal("fetch", vi.fn(handler));
  return state;
}

/** The environment both hosts' clients read, set for one test. */
export function fakeHostEnv(): Record<string, string> {
  return {
    HOSTINGER_API_TOKEN: "test-token",
    DA_HOST,
    DA_USERNAME: "dauser",
    DA_LOGIN_KEY: "da-login-key",
    DA_DOMAIN,
    PROTECTED_DOMAINS: "sedsolutions.online,aqhsn.com",
  };
}

export function withEnv(vars: Record<string, string | undefined>): () => void {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}
