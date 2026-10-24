import { createHash, randomBytes } from "node:crypto";
import {
  findWebsite,
  hostingerConfigured,
  isStaticWebsite,
  listWebsiteDir,
  makeWebsiteFolder,
  moveWebsiteFile,
  openFileSession,
  readWebsiteFile,
  removeWebsiteFile,
  statWebsiteFile,
  uploadWebsiteFile,
  type FileSession,
  type HostingerWebsite,
} from "@/lib/hostinger/client";
import {
  daConfigured,
  docrootFor,
  listDaFolder,
  listDocrootDir,
  makeDaFolder,
  moveDaFile,
  readDocrootFile,
  removeDaPaths,
  siteFolderFor,
  subFromWebsiteLink,
  uploadDaFile,
} from "@/lib/template-engine/directadmin";
import { hostCandidates } from "@/lib/site-studio/deploy/liveFiles";
import { isProtectedDomain, protectedDomains } from "@/lib/site-studio/deploy/protected";
import type { Deadline } from "./deadline";
import { MAX_FILE_BYTES, cmsPathAllowed } from "./paths";

/**
 * Single files of a client site, for SED CMS publishing. SERVER ONLY.
 *
 * Never the whole docroot (client sites reach 1.3 GB): one folder listing,
 * one read, one write at a time, through the hosts the LMS already uses —
 *   - staging subdomains ({sub}.DA_DOMAIN): DirectAdmin's file manager;
 *   - custom domains: Hostinger's File Browser, static websites only.
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
 * A live file is never half-written. A write:
 *   1. uploads the bytes to a temporary file under a random name — outside
 *      the web root, in the folder that holds public_html (TEMP_PLACEMENT
 *      "outside"), or, for a host that can't reach there, as a dot-named
 *      file beside the live one ("beside");
 *   2. checks it: its size, and its sha256 where the host computes one;
 *   3. moves it over the live file in ONE call (a rename with override) —
 *      the only call that touches the live path;
 *   4. on any failure before the move, removes the temporary file (best
 *      effort) and leaves the live file as it was.
 * A missing folder is made first, by a call that writes no file.
 *
 * Time (lib/sedcms/deadline.ts): each host call has its own 30 s in the
 * clients. With a deadline, no step starts once it has passed (reason
 * "deadline"); reads, listings and checks in flight stop at it. A move in
 * flight is never cut. When the deadline passes between the upload and the
 * move, the move doesn't start: the temporary file is removed (that clean-up
 * is the one call allowed after the deadline) and the file is not written.
 */

export type SiteFilesStep = "list" | "read" | "write";
export type SiteFilesReason = "refused" | "not_a_file" | "too_large" | "hosting" | "deadline";

export class SiteFilesError extends Error {
  readonly step: SiteFilesStep;
  readonly reason: SiteFilesReason;
  readonly path: string | null;
  /** The live file may have been replaced: only when the move itself failed,
   *  since its outcome can't be known. Every earlier failure left it as it was. */
  readonly maybeWritten: boolean;

  constructor(step: SiteFilesStep, reason: SiteFilesReason, message: string, path: string | null = null, opts: { maybeWritten?: boolean } = {}) {
    super(message);
    this.name = "SiteFilesError";
    this.step = step;
    this.reason = reason;
    this.path = path;
    this.maybeWritten = opts.maybeWritten ?? false;
  }
}

/** Where a host's temporary files go (see above). */
export type TempPlacement = "outside" | "beside";

/**
 * Both hosts' file APIs reach the folder that holds public_html: the File
 * Browser's root is that folder (its paths start /public_html), and
 * DirectAdmin's file manager takes any path of the account
 * (/domains/<sub>.<domain>/…). The live spike confirms both can write and
 * move there; a host that can't is switched to "beside" here.
 */
export const TEMP_PLACEMENT: Readonly<Record<"staging" | "custom", TempPlacement>> = Object.freeze({ staging: "outside", custom: "outside" });

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
type StepResult = { ok: true; leftover?: string } | { ok: false; stopped?: boolean; leftover?: string; message: string };
type CheckResult = { ok: true; isFile: boolean; size: number | null; sha256: string | null } | { ok: false; message: string };

/**
 * What each host must do; everything else is shared. Temporary files are
 * named by their host's own absolute path. `signal` stops a read, a listing
 * or a check; `canContinue` is asked between the calls of one step.
 */
interface HostOps {
  listDir(relDir: string, signal?: AbortSignal): Promise<Entry[] | null>;
  readFile(relPath: string, maxBytes: number, signal?: AbortSignal): Promise<ReadResult>;
  /** Make these folders of the web root, top down (each one's parent exists before it); writes no file. */
  makeDirs(levels: string[], canContinue: () => boolean): Promise<StepResult>;
  /** Where this write's temporary file goes. */
  tempFor(relPath: string, name: string): string;
  /** Upload the bytes to the temporary file; never touches a live path. */
  stage(temp: string, bytes: Uint8Array, canContinue: () => boolean): Promise<StepResult>;
  /** The temporary file's size, and its sha256 where the host computes one. */
  check(temp: string, signal?: AbortSignal): Promise<CheckResult>;
  /** ONE call: the temporary file replaces the live one. */
  swap(temp: string, relPath: string): Promise<StepResult>;
  /** Best effort; true when the temporary file is gone. */
  discard(temp: string): Promise<boolean>;
}

const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const folderOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** The folders from `first` down to `last` ("a/b", "a/b/c" ...), top down. */
function foldersFrom(first: string, last: string): string[] {
  const levels = [first];
  for (const segment of last.slice(first.length).split("/").filter(Boolean)) levels.push(`${levels[levels.length - 1]}/${segment}`);
  return levels;
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
  private async locate(
    path: string,
    step: SiteFilesStep,
    limits: CallLimits,
  ): Promise<{ entry: Entry | null; parentExists: boolean; firstMissing: string | null }> {
    const segments = path.split("/");
    let rel = "";
    for (let i = 0; i < segments.length - 1; i++) {
      const found = (await this.dir(rel, step, limits, path)).find((e) => e.name === segments[i]);
      if (!found) return { entry: null, parentExists: false, firstMissing: rel ? `${rel}/${segments[i]}` : segments[i] };
      if (found.kind !== "dir") throw new SiteFilesError(step, "not_a_file", "a folder on the path is not a folder", path);
      rel = rel ? `${rel}/${segments[i]}` : segments[i];
    }
    const name = segments[segments.length - 1];
    return { entry: (await this.dir(rel, step, limits, path)).find((e) => e.name === name) ?? null, parentExists: true, firstMissing: null };
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
    const { entry, parentExists, firstMissing } = await this.locate(path, "write", limits);
    if (entry && entry.kind !== "file") throw new SiteFilesError("write", "not_a_file", "something other than a file is there", path);
    const late = () => limits.deadline?.passed() ?? false;
    const canContinue = () => !late();
    // The last moment to decide: past the deadline, this write never starts.
    if (late()) throw outOfTime("write", path);

    try {
      if (!parentExists && firstMissing) {
        const made = await this.ops.makeDirs(foldersFrom(firstMissing, folderOf(path)), canContinue);
        this.warnLeftover(made.leftover);
        if (!made.ok) throw new SiteFilesError("write", made.stopped || late() ? "deadline" : "hosting", made.message, path);
        if (late()) throw outOfTime("write", path);
      }

      const temp = this.ops.tempFor(path, `sedcms-${randomBytes(8).toString("hex")}.tmp`);
      // Before the move the live file is untouched: a failure removes the temporary file and says so.
      const abandon = async (reason: SiteFilesReason, message: string) => {
        await this.discard(temp);
        return new SiteFilesError("write", reason, message, path);
      };

      const staged = await this.ops.stage(temp, bytes, canContinue);
      this.warnLeftover(staged.leftover);
      if (!staged.ok) throw await abandon(staged.stopped || late() ? "deadline" : "hosting", staged.message);
      if (late()) throw await abandon("deadline", "out of time before the check");

      const checked = await this.ops.check(temp, limits.deadline?.signal);
      if (!checked.ok) throw await abandon(late() ? "deadline" : "hosting", checked.message);
      if (!checked.isFile || checked.size !== bytes.length || (checked.sha256 !== null && checked.sha256 !== sha256Hex(bytes))) {
        throw await abandon("hosting", "the temporary file is not what was sent");
      }
      if (late()) throw await abandon("deadline", "out of time before the move");

      const moved = await this.ops.swap(temp, path);
      if (!moved.ok) {
        // The move's outcome can't be known: the live file may or may not have been replaced.
        await this.discard(temp);
        throw new SiteFilesError("write", "hosting", moved.message, path, { maybeWritten: true });
      }
    } finally {
      this.listings.clear(); // whatever happened, the folders may have changed
    }
  }

  private async discard(temp: string): Promise<void> {
    const gone = await this.ops.discard(temp).catch(() => false);
    if (!gone) this.warnLeftover(nameOf(temp));
  }

  private warnLeftover(name: string | undefined): void {
    if (name) console.warn(`[sedcms] ${this.label}: the temporary file ${name} could not be removed`);
  }
}

function hostingerOps(session: FileSession, placement: TempPlacement): HostOps {
  const live = (rel: string) => `${session.dir}/${rel}`;
  return {
    listDir: (relDir, signal) => listWebsiteDir(session, relDir, { signal }),
    readFile: (relPath, maxBytes, signal) => readWebsiteFile(session, relPath, maxBytes, { signal }),
    // the File Browser makes the parents too (MkdirAll): one call, for the deepest level
    makeDirs: (levels) => makeWebsiteFolder(session, live(levels[levels.length - 1])),
    // "outside": the File Browser's folder that holds public_html
    tempFor: (relPath, name) =>
      placement === "outside" ? `${folderOf(session.dir)}/${name}` : `${folderOf(live(relPath))}/.${name}`,
    stage: (temp, bytes, canContinue) => uploadWebsiteFile(session, temp, bytes, { canContinue }),
    check: async (temp, signal) => {
      const r = await statWebsiteFile(session, temp, { signal });
      return r.ok ? { ok: true, isFile: !r.isDir, size: r.size, sha256: r.sha256 } : r;
    },
    swap: (temp, relPath) => moveWebsiteFile(session, temp, live(relPath)),
    discard: async (temp) => (await removeWebsiteFile(session, temp)).ok,
  };
}

/**
 * DirectAdmin: each missing folder level by its own mkdir, top down; none
 * starts after the deadline. An mkdir that fails counts as made only when a
 * listing of its parent then shows a folder of that name (made meanwhile).
 */
async function makeDaFolders(sub: string, levels: string[], canContinue: () => boolean): Promise<StepResult> {
  for (const level of levels) {
    if (!canContinue()) return { ok: false, stopped: true, message: "out of time before making a folder" };
    const made = await makeDaFolder(`${docrootFor(sub)}/${level}`);
    if (made.ok) continue;
    if (!canContinue()) return { ok: false, stopped: true, message: "out of time before checking a folder" };
    const parent = folderOf(level);
    const there = (await listDaFolder(parent ? `${docrootFor(sub)}/${parent}` : docrootFor(sub)))?.find((e) => e.name === nameOf(level));
    if (there?.kind !== "dir") return { ok: false, message: made.message };
  }
  return { ok: true };
}

function directAdminOps(sub: string, placement: TempPlacement): HostOps {
  return {
    listDir: (relDir, signal) => listDocrootDir(sub, relDir, { signal }),
    readFile: (relPath, maxBytes, signal) => readDocrootFile(sub, relPath, maxBytes, { signal }),
    makeDirs: (levels, canContinue) => makeDaFolders(sub, levels, canContinue),
    // "outside": the subdomain's own folder, which holds its public_html
    tempFor: (relPath, name) => {
      if (placement === "outside") return `${siteFolderFor(sub)}/${name}`;
      const dir = folderOf(relPath);
      return `${docrootFor(sub)}${dir ? `/${dir}` : ""}/.${name}`;
    },
    stage: (temp, bytes) => uploadDaFile(folderOf(temp), nameOf(temp), bytes),
    // DirectAdmin's listing gives the size; it computes no checksum
    check: async (temp, signal) => {
      const entries = await listDaFolder(folderOf(temp), { signal });
      if (!entries) return { ok: false, message: "the temporary file's folder could not be listed" };
      const entry = entries.find((e) => e.name === nameOf(temp));
      if (!entry) return { ok: false, message: "the temporary file is not there" };
      return { ok: true, isFile: entry.kind === "file", size: entry.size, sha256: null };
    },
    swap: (temp, relPath) => moveDaFile(temp, `${docrootFor(sub)}/${relPath}`),
    discard: async (temp) => (await removeDaPaths([temp])).ok,
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

/** The names one site is served under: the host, its apex and its www. twin. */
function siteNames(host: string): string[] {
  const apex = host.replace(/^www[.]/, "");
  return [...new Set([host, apex, `www.${apex}`])];
}

/**
 * Is the site at `host` a protected company website? Every name it is served
 * under (the host, its apex, its www. twin) is checked against
 * PROTECTED_DOMAINS, exact or as a subdomain of an entry. For a staging site
 * the staging apex (DA_DOMAIN) protects only itself and its www. twin, as
 * every staging site is under it; any other entry counts in full, so a
 * protected subdomain of DA_DOMAIN stays protected.
 */
export function isProtectedSite(host: string): boolean {
  const daDomain = (process.env.DA_DOMAIN ?? "").toLowerCase();
  const names = siteNames(host);
  const staging = daDomain !== "" && subFromWebsiteLink(`https://${host}`, daDomain) !== null;
  if (!staging) return names.some((name) => isProtectedDomain(name));
  if (names.includes(daDomain)) return true;
  const entries = protectedDomains().filter((d) => d !== daDomain);
  return names.some((name) => entries.some((d) => name === d || name.endsWith(`.${d}`)));
}

const protectedRefusal = (host: string): SiteRefusal => ({ ok: false, status: 403, code: "PROTECTED", error: `${host} is a protected company domain.` });

/** Which host serves the site at `host`, or why the CMS may not touch it. */
export async function resolveSite(host: string): Promise<SiteResolution> {
  if (!isPlainHost(host)) return { ok: false, status: 422, code: "NOT_STATIC", error: "That is not a website address the CMS can edit." };

  const daDomain = process.env.DA_DOMAIN ?? "";
  const sub = daDomain ? subFromWebsiteLink(`https://${host}`, daDomain) : null;
  if (sub) {
    if (!LABEL.test(sub)) return { ok: false, status: 422, code: "NOT_STATIC", error: "That is not a website address the CMS can edit." };
    if (isProtectedSite(host)) return protectedRefusal(host);
    if (!daConfigured()) return { ok: false, status: 502, code: "HOSTING", error: "The staging hosting is not configured on the LMS." };
    return { ok: true, kind: "staging", host, sub };
  }

  if (isProtectedSite(host)) return protectedRefusal(host);
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

/** The site at `host`, as single files. `placement` overrides TEMP_PLACEMENT (tests; a host the spike moves to "beside" changes TEMP_PLACEMENT itself). */
export async function siteFilesFor(host: string, opts: { placement?: TempPlacement } = {}): Promise<SiteFilesResult> {
  const site = await resolveSite(host);
  if (!site.ok) return site;
  if (site.kind === "staging") {
    return { ok: true, kind: "staging", host, key: `staging:${site.sub}`, files: new HostedSiteFiles(directAdminOps(site.sub, opts.placement ?? TEMP_PLACEMENT.staging), host) };
  }
  const opened = await openFileSession(site.website);
  if (!opened.ok) {
    if (opened.pending) return { ok: false, status: 409, code: "HOSTING_PENDING", error: "The website is still being set up on the hosting." };
    console.warn(`[sedcms] ${host}: could not open the file server: ${opened.message}`);
    return { ok: false, status: 502, code: "HOSTING", error: "The website's file server could not be opened." };
  }
  const domain = site.website.domain.toLowerCase();
  return { ok: true, kind: "custom", host, key: `custom:${domain}`, files: new HostedSiteFiles(hostingerOps(opened.session, opts.placement ?? TEMP_PLACEMENT.custom), domain) };
}
