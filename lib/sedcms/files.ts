import {
  findWebsite,
  hostingerConfigured,
  isStaticWebsite,
  listWebsiteDir,
  openFileSession,
  readWebsiteFile,
  writeWebsiteFile,
  type FileSession,
  type HostingerWebsite,
} from "@/lib/hostinger/client";
import {
  daConfigured,
  listDocrootDir,
  readDocrootFile,
  subFromWebsiteLink,
  writeDocrootFile,
} from "@/lib/template-engine/directadmin";
import { hostCandidates } from "@/lib/site-studio/deploy/liveFiles";
import { isProtectedDomain } from "@/lib/site-studio/deploy/protected";
import type { Deadline } from "./deadline";
import { MAX_FILE_BYTES, cmsPathAllowed } from "./paths";

/**
 * Single files of a client site, for SED CMS publishing. SERVER ONLY.
 *
 * Never the whole docroot (client sites reach 1.3 GB): one folder listing,
 * one read, one write at a time, through the hosts the LMS already uses —
 *   - staging subdomains ({sub}.DA_DOMAIN): DirectAdmin's file manager;
 *   - custom domains: Hostinger's File Browser (raw reads, TUS writes),
 *     static websites only.
 * The branching is liveFiles.ts's: the staging check comes before the
 * protected-domain check (DA_DOMAIN is always protected), then Hostinger.
 *
 * Every path is checked with cmsPathAllowed before any request. Whether a file
 * exists, and that it is a plain file, comes from the folder listings (walked
 * from the docroot, never through a link); a read whose length isn't the
 * listed size is refused, so a host's error page is never taken for a file.
 * Failures throw SiteFilesError, which says which step failed and never
 * carries file content.
 *
 * Time (lib/sedcms/deadline.ts): each host call has its own 30 s in the
 * clients. With a deadline, no host call starts once it has passed (reason
 * "deadline"); reads and listings in flight stop at it; a write in flight is
 * never cut — a Hostinger write's create and bytes run together, and
 * DirectAdmin's zip path asks before extracting and before cleaning up.
 */

export type SiteFilesStep = "list" | "read" | "write";
export type SiteFilesReason = "refused" | "not_a_file" | "too_large" | "hosting" | "deadline";

export class SiteFilesError extends Error {
  readonly step: SiteFilesStep;
  readonly reason: SiteFilesReason;
  readonly path: string | null;

  constructor(step: SiteFilesStep, reason: SiteFilesReason, message: string, path: string | null = null) {
    super(message);
    this.name = "SiteFilesError";
    this.step = step;
    this.reason = reason;
    this.path = path;
  }
}

export interface ListedFile {
  path: string;
  /** null when the host's listing gave no size */
  size: number | null;
}

/** When to stop starting host calls. */
export interface CallLimits {
  deadline?: Deadline;
}

export interface SiteFiles {
  /** Files up to maxDepth segments deep, at most maxEntries, sorted by path.
   *  Hidden names, links and cgi-bin are never listed or walked into. */
  list(maxDepth: number, maxEntries: number, limits?: CallLimits): Promise<{ files: ListedFile[]; truncated: boolean }>;
  /** A file's exact bytes; null when there is no such file. */
  read(path: string, maxBytes: number, limits?: CallLimits): Promise<Uint8Array | null>;
  /** Overwrite (or create) one file, creating its folders. */
  write(path: string, bytes: Uint8Array, limits?: CallLimits): Promise<void>;
}

interface Entry {
  name: string;
  kind: "file" | "dir" | "other";
  size: number | null;
}

type ReadResult = { ok: true; bytes: Uint8Array | null } | { ok: false; tooLarge: boolean; message: string };
type WriteResult = { ok: true; leftover?: string } | { ok: false; stopped?: boolean; leftover?: string; message: string };

/** What each host must do; everything else is shared. `signal` stops a read
 *  or a listing; `canContinue` is asked between the steps of a write. */
interface HostOps {
  listDir(relDir: string, signal?: AbortSignal): Promise<Entry[] | null>;
  readFile(relPath: string, maxBytes: number, signal?: AbortSignal): Promise<ReadResult>;
  writeFile(relPath: string, bytes: Uint8Array, parentExists: boolean, canContinue: () => boolean): Promise<WriteResult>;
}

/** A walk never lists more folders than this. */
const MAX_DIRS_LISTED = 500;

const listable = (name: string) => name.length > 0 && !name.startsWith(".") && !name.includes("/") && !name.includes(String.fromCharCode(0));

const byPath = (a: ListedFile, b: ListedFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

const outOfTime = (step: SiteFilesStep, path: string | null) => new SiteFilesError(step, "deadline", "out of time: not started", path);

class HostedSiteFiles implements SiteFiles {
  private readonly listings = new Map<string, Promise<Entry[] | null>>();

  constructor(
    private readonly ops: HostOps,
    private readonly label: string,
  ) {}

  private async dir(relDir: string, step: SiteFilesStep, limits: CallLimits, path: string | null): Promise<Entry[]> {
    let pending = this.listings.get(relDir);
    if (!pending) {
      if (limits.deadline?.passed()) throw outOfTime(step, path);
      pending = this.ops.listDir(relDir, limits.deadline?.signal);
      this.listings.set(relDir, pending);
    }
    const entries = await pending;
    if (!entries) {
      this.listings.delete(relDir);
      if (limits.deadline?.passed()) throw new SiteFilesError(step, "deadline", `out of time listing ${relDir || "the docroot"}`, path);
      throw new SiteFilesError(step, "hosting", `could not list ${relDir || "the docroot"}`, path);
    }
    return entries;
  }

  /** The entry at path, walking folder listings from the docroot. */
  private async locate(path: string, step: SiteFilesStep, limits: CallLimits): Promise<{ entry: Entry | null; parentExists: boolean }> {
    const segments = path.split("/");
    let rel = "";
    for (let i = 0; i < segments.length - 1; i++) {
      const found = (await this.dir(rel, step, limits, path)).find((e) => e.name === segments[i]);
      if (!found) return { entry: null, parentExists: false };
      if (found.kind !== "dir") throw new SiteFilesError(step, "not_a_file", "a folder on the path is not a folder", path);
      rel = rel ? `${rel}/${segments[i]}` : segments[i];
    }
    const name = segments[segments.length - 1];
    return { entry: (await this.dir(rel, step, limits, path)).find((e) => e.name === name) ?? null, parentExists: true };
  }

  async list(maxDepth: number, maxEntries: number, limits: CallLimits = {}): Promise<{ files: ListedFile[]; truncated: boolean }> {
    const files: ListedFile[] = [];
    const queue: { rel: string; depth: number }[] = [{ rel: "", depth: 1 }];
    let listed = 0;
    let truncated = false;
    walk: while (queue.length > 0) {
      const { rel, depth } = queue.shift()!;
      if (++listed > MAX_DIRS_LISTED) {
        truncated = true;
        break;
      }
      const entries = [...(await this.dir(rel, "list", limits, null))].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const e of entries) {
        if (!listable(e.name)) continue;
        const path = rel ? `${rel}/${e.name}` : e.name;
        if (e.kind === "dir") {
          if (depth < maxDepth && !(rel === "" && e.name.toLowerCase() === "cgi-bin")) queue.push({ rel: path, depth: depth + 1 });
        } else if (e.kind === "file") {
          if (files.length >= maxEntries) {
            truncated = true;
            break walk;
          }
          files.push({ path, size: e.size });
        }
      }
    }
    return { files: files.sort(byPath), truncated };
  }

  async read(path: string, maxBytes: number, limits: CallLimits = {}): Promise<Uint8Array | null> {
    if (!cmsPathAllowed(path)) throw new SiteFilesError("read", "refused", "the path is not one the CMS may read", path);
    const { entry } = await this.locate(path, "read", limits);
    if (!entry) return null;
    if (entry.kind !== "file") throw new SiteFilesError("read", "not_a_file", "not a plain file", path);
    if (entry.size !== null && entry.size > maxBytes) throw new SiteFilesError("read", "too_large", `larger than ${maxBytes} bytes`, path);
    if (limits.deadline?.passed()) throw outOfTime("read", path);
    const r = await this.ops.readFile(path, maxBytes, limits.deadline?.signal);
    if (!r.ok) {
      if (limits.deadline?.passed()) throw new SiteFilesError("read", "deadline", "out of time while reading", path);
      throw new SiteFilesError("read", r.tooLarge ? "too_large" : "hosting", r.message, path);
    }
    if (r.bytes === null) return null;
    if (entry.size !== null && r.bytes.length !== entry.size) {
      throw new SiteFilesError("read", "hosting", "the bytes read are not the size the listing gave", path);
    }
    return r.bytes;
  }

  async write(path: string, bytes: Uint8Array, limits: CallLimits = {}): Promise<void> {
    if (!cmsPathAllowed(path)) throw new SiteFilesError("write", "refused", "the path is not one the CMS may write", path);
    if (bytes.length > MAX_FILE_BYTES) throw new SiteFilesError("write", "refused", `larger than ${MAX_FILE_BYTES} bytes`, path);
    const { entry, parentExists } = await this.locate(path, "write", limits);
    if (entry && entry.kind !== "file") throw new SiteFilesError("write", "not_a_file", "something other than a file is there", path);
    // The last moment to decide: past the deadline, this write never starts.
    if (limits.deadline?.passed()) throw outOfTime("write", path);
    const canContinue = () => !limits.deadline?.passed();
    let r: WriteResult;
    try {
      r = await this.ops.writeFile(path, bytes, parentExists, canContinue);
    } finally {
      this.listings.clear(); // whatever happened, the folders may have changed
    }
    if (r.leftover) console.warn(`[sedcms] ${this.label}: a temporary ${r.leftover} was left in the docroot`);
    if (!r.ok) throw new SiteFilesError("write", r.stopped ? "deadline" : "hosting", r.message, path);
  }
}

function hostingerOps(session: FileSession): HostOps {
  return {
    listDir: (relDir, signal) => listWebsiteDir(session, relDir, { signal }),
    readFile: (relPath, maxBytes, signal) => readWebsiteFile(session, relPath, maxBytes, { signal }),
    // The create and the bytes are one write: nothing may stop between them.
    writeFile: (relPath, bytes) => writeWebsiteFile(session, relPath, bytes),
  };
}

function directAdminOps(sub: string): HostOps {
  return {
    listDir: (relDir, signal) => listDocrootDir(sub, relDir, { signal }),
    readFile: (relPath, maxBytes, signal) => readDocrootFile(sub, relPath, maxBytes, { signal }),
    writeFile: (relPath, bytes, parentExists, canContinue) => writeDocrootFile(sub, relPath, bytes, { parentExists, canContinue }),
  };
}

// ---------------------------------------------------------------------------
// which host serves a site

export type SiteRefusal = {
  ok: false;
  status: 403 | 409 | 422 | 502;
  code: "PROTECTED" | "NOT_STATIC" | "HOSTING" | "HOSTING_PENDING";
  error: string;
};

export type SiteResolution =
  | { ok: true; kind: "staging"; host: string; sub: string }
  | { ok: true; kind: "custom"; host: string; website: HostingerWebsite }
  | SiteRefusal;

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** A lowercase host name of plain labels: no port, scheme, path or trailing dot. */
export function isPlainHost(host: unknown): host is string {
  if (typeof host !== "string" || host.length === 0 || host.length > 253) return false;
  const labels = host.split(".");
  return labels.length >= 2 && labels.every((l) => LABEL.test(l));
}

/** Which host serves the site at `host`, or why the CMS may not touch it. */
export async function resolveSite(host: string): Promise<SiteResolution> {
  if (!isPlainHost(host)) return { ok: false, status: 422, code: "NOT_STATIC", error: "That is not a website address the CMS can edit." };

  const daDomain = process.env.DA_DOMAIN ?? "";
  const sub = daDomain ? subFromWebsiteLink(`https://${host}`, daDomain) : null;
  if (sub) {
    if (!LABEL.test(sub)) return { ok: false, status: 422, code: "NOT_STATIC", error: "That is not a website address the CMS can edit." };
    if (!daConfigured()) return { ok: false, status: 502, code: "HOSTING", error: "The staging hosting is not configured on the LMS." };
    return { ok: true, kind: "staging", host, sub };
  }

  if (isProtectedDomain(host)) {
    return { ok: false, status: 403, code: "PROTECTED", error: `${host} is a protected company domain.` };
  }
  if (!hostingerConfigured()) return { ok: false, status: 502, code: "HOSTING", error: "The hosting is not configured on the LMS." };

  for (const candidate of hostCandidates(host)) {
    const website = await findWebsite(candidate);
    if (website === "error") return { ok: false, status: 502, code: "HOSTING", error: "The hosting could not be read." };
    if (!website) continue;
    if (!isStaticWebsite(website)) {
      return { ok: false, status: 422, code: "NOT_STATIC", error: `${candidate} is not a static website.` };
    }
    return { ok: true, kind: "custom", host, website };
  }
  return { ok: false, status: 422, code: "NOT_STATIC", error: `${host} is not hosted on the company hosting.` };
}

export type SiteFilesResult =
  | { ok: true; files: SiteFiles; kind: "staging" | "custom"; host: string; /** one per site: the per-site write lock's key */ key: string }
  | SiteRefusal;

export async function siteFilesFor(host: string): Promise<SiteFilesResult> {
  const site = await resolveSite(host);
  if (!site.ok) return site;
  if (site.kind === "staging") {
    return { ok: true, kind: "staging", host, key: `staging:${site.sub}`, files: new HostedSiteFiles(directAdminOps(site.sub), host) };
  }
  const opened = await openFileSession(site.website);
  if (!opened.ok) {
    if (opened.pending) return { ok: false, status: 409, code: "HOSTING_PENDING", error: "The website is still being set up on the hosting." };
    console.warn(`[sedcms] ${host}: could not open the file server: ${opened.message}`);
    return { ok: false, status: 502, code: "HOSTING", error: "The website's file server could not be opened." };
  }
  const domain = site.website.domain.toLowerCase();
  return { ok: true, kind: "custom", host, key: `custom:${domain}`, files: new HostedSiteFiles(hostingerOps(opened.session), domain) };
}
