import type { SupabaseClient } from "@supabase/supabase-js";
import { cloudflareConfigured, purgeCacheByUrls } from "@/lib/cloudflare/client";
import type { Deadline } from "./deadline";
import { SiteFilesError, type SiteFiles } from "./files";
import { MAX_FILE_BYTES, cmsPathAllowed } from "./paths";
import { HASH_READ_MAX_BYTES, sha256Hex } from "./read";

/**
 * Applying a SED CMS change set to a lead's live site. SERVER ONLY.
 * "Apply, in the LMS, in order" (launch plan, the CMS <-> LMS contract):
 *   1. the host is resolved (the route);
 *   2. one apply at a time per site (an in-process lock);
 *   3. every target's live bytes are read first: any whose sha256 is
 *      neither expectedSha256 (null: must not exist) nor already the new
 *      content is a conflict, and a conflict writes nothing;
 *   4. the files are written one by one, in the order given; one already
 *      at its new bytes is "unchanged" and not written, so a retried
 *      request answers 200 without writing again;
 *   5. Cloudflare is purged, best effort, when the lead's domain has a zone;
 *   6. one activity_log row (never any file content);
 *   7. the lock is released.
 *
 * Time (lib/sedcms/deadline.ts): the route gives the apply a deadline 240 s
 * after the request was accepted, lock wait included. No read, write or purge
 * starts after it; a read in flight stops at it; a write in flight finishes on
 * its own 30 s. An apply the deadline cuts answers as a partial failure
 * (what was written, and the first file that wasn't), is never purged, and
 * the CMS's "Check" settles it.
 */

export const APPLY_MAX_FILES = 50;
export const APPLY_MAX_TOTAL_BYTES = 20 * 1024 * 1024;

export interface ApplyChange {
  path: string;
  expectedSha256: string | null;
  contentBase64: string;
}

export interface DecodedChange {
  path: string;
  expectedSha256: string | null;
  bytes: Uint8Array;
  sha256: string;
}

const SHA256 = /^[0-9a-f]{64}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** The decoded size of canonical base64, or null when it isn't canonical base64. */
function base64Size(s: string): number | null {
  if (s.length % 4 !== 0 || !BASE64.test(s)) return null;
  const padding = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  return (s.length / 4) * 3 - padding;
}

/**
 * The change set, checked and decoded: at most 50 files, each path allowed
 * by the shared rules and named once, each checksum lowercase hex or null,
 * each content strict base64 of at most 5 MiB and 20 MiB in all — sized
 * before anything is decoded.
 */
export function decodeChanges(changes: ApplyChange[]): { ok: true; changes: DecodedChange[] } | { ok: false; message: string } {
  if (changes.length > APPLY_MAX_FILES) return { ok: false, message: `At most ${APPLY_MAX_FILES} files at once.` };
  const seen = new Set<string>();
  let total = 0;
  for (const c of changes) {
    if (!cmsPathAllowed(c.path)) return { ok: false, message: "A path is not one the CMS may write." };
    if (seen.has(c.path)) return { ok: false, message: "A path is named twice." };
    seen.add(c.path);
    if (c.expectedSha256 !== null && !SHA256.test(c.expectedSha256)) return { ok: false, message: "A checksum is not a lowercase hex SHA-256." };
    const size = base64Size(c.contentBase64);
    if (size === null) return { ok: false, message: "A file's content is not base64." };
    if (size > MAX_FILE_BYTES) return { ok: false, message: "A file is over 5 MiB." };
    total += size;
    if (total > APPLY_MAX_TOTAL_BYTES) return { ok: false, message: "The files are over 20 MiB in all." };
  }
  const decoded: DecodedChange[] = changes.map((c) => {
    const bytes = new Uint8Array(Buffer.from(c.contentBase64, "base64"));
    return { path: c.path, expectedSha256: c.expectedSha256, bytes, sha256: sha256Hex(bytes) };
  });
  for (const [i, d] of decoded.entries()) {
    if (d.bytes.length !== base64Size(changes[i].contentBase64)) return { ok: false, message: "A file's content is not base64." };
  }
  return { ok: true, changes: decoded };
}

// ---------------------------------------------------------------------------
// one apply at a time per site

const LOCKS = Symbol.for("sedcms.applyLocks");

function locks(): Map<string, Promise<void>> {
  const g = globalThis as unknown as Record<symbol, Map<string, Promise<void>> | undefined>;
  return (g[LOCKS] ??= new Map());
}

/** Runs fn once every earlier holder of `key` has finished (in-process: the LMS runs one process). */
export async function withSiteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const map = locks();
  const before = map.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => (release = resolve));
  const tail = before.then(() => mine);
  map.set(key, tail);
  await before;
  try {
    return await fn();
  } finally {
    release();
    if (map.get(key) === tail) map.delete(key);
  }
}

// ---------------------------------------------------------------------------
// the apply

export interface ApplyResult {
  path: string;
  outcome: "written" | "unchanged";
  sha256: string;
}

export type ApplyOutcome =
  | { kind: "applied"; results: ApplyResult[] }
  | { kind: "conflict"; files: { path: string; expectedSha256: string | null; liveSha256: string | null }[] }
  | {
      kind: "failed";
      results: ApplyResult[];
      failed: { path: string; step: "read" | "write" };
      /** a write was started (so the site may have changed) */
      wrote: boolean;
      /** the deadline stopped it, rather than a host */
      cut: boolean;
    };

const isLate = (e: unknown) => e instanceof SiteFilesError && e.reason === "deadline";

export async function applyChanges(files: SiteFiles, changes: DecodedChange[], opts: { deadline?: Deadline } = {}): Promise<ApplyOutcome> {
  const limits = { deadline: opts.deadline };
  const late = () => opts.deadline?.passed() ?? false;

  // 3. every target's live bytes, before anything is written
  const already = new Set<string>();
  const conflicts: { path: string; expectedSha256: string | null; liveSha256: string | null }[] = [];
  for (const c of changes) {
    if (late()) return { kind: "failed", results: [], failed: { path: c.path, step: "read" }, wrote: false, cut: true };
    let live: Uint8Array | null;
    try {
      live = await files.read(c.path, HASH_READ_MAX_BYTES, limits);
    } catch (e) {
      logFailure(e, c.path, "read");
      return { kind: "failed", results: [], failed: { path: c.path, step: "read" }, wrote: false, cut: isLate(e) };
    }
    const liveSha256 = live === null ? null : sha256Hex(live);
    if (liveSha256 === c.sha256) already.add(c.path);
    else if (liveSha256 !== c.expectedSha256) conflicts.push({ path: c.path, expectedSha256: c.expectedSha256, liveSha256 });
  }
  if (conflicts.length > 0) return { kind: "conflict", files: conflicts };

  // 4. one by one, in the order given; none started after the deadline
  const results: ApplyResult[] = [];
  const someWritten = () => results.some((r) => r.outcome === "written");
  for (const c of changes) {
    if (already.has(c.path)) {
      results.push({ path: c.path, outcome: "unchanged", sha256: c.sha256 });
      continue;
    }
    if (late()) return { kind: "failed", results, failed: { path: c.path, step: "write" }, wrote: someWritten(), cut: true };
    try {
      await files.write(c.path, c.bytes, limits);
    } catch (e) {
      logFailure(e, c.path, "write");
      // A write stages, checks, then moves in one call: only a failed move may
      // have changed the live file (an unexpected error is counted as one too).
      const mayHaveChanged = !(e instanceof SiteFilesError) || e.maybeWritten;
      return { kind: "failed", results, failed: { path: c.path, step: "write" }, wrote: someWritten() || mayHaveChanged, cut: isLate(e) };
    }
    results.push({ path: c.path, outcome: "written", sha256: c.sha256 });
  }
  return { kind: "applied", results };
}

function logFailure(e: unknown, path: string, step: string) {
  const reason = e instanceof SiteFilesError ? e.reason : "error";
  console.warn(`[sedcms] apply: ${step} of ${path} failed (${reason}): ${e instanceof Error ? e.message : "unknown error"}`);
}

// ---------------------------------------------------------------------------
// 5. Cloudflare, best effort

/** The URLs a written file is served at: the host and its www/apex twin; an
 *  index page also at its folder. */
export function purgeUrls(host: string, domain: string, paths: string[]): string[] {
  const hosts = host === domain ? [host, `www.${domain}`] : host === `www.${domain}` ? [host, domain] : [host];
  const urls: string[] = [];
  for (const h of hosts) {
    for (const p of paths) {
      urls.push(`https://${h}/${p}`);
      const name = p.slice(p.lastIndexOf("/") + 1);
      if (name === "index.html" || name === "index.htm") urls.push(`https://${h}/${p.slice(0, p.length - name.length)}`);
    }
  }
  return urls;
}

/**
 * Purge the written files when Cloudflare fronts the lead's domain (its
 * client_domains row, not a failed one, has a zone, and the site's host is
 * that domain or under it). Never throws: true only when every purge call
 * succeeded. Nothing is sent once the deadline has passed.
 */
export async function purgeWritten(admin: SupabaseClient, leadId: string, host: string, written: string[], deadline?: Deadline): Promise<boolean> {
  if (written.length === 0 || !cloudflareConfigured() || deadline?.passed()) return false;
  try {
    const { data, error } = await admin.from("client_domains").select("domain, cf_zone_id, status").eq("lead_id", leadId);
    if (error || !Array.isArray(data)) return false;
    const row = (data as { domain: string; cf_zone_id: string | null; status: string }[]).find(
      (d) => d.status !== "failed" && d.cf_zone_id && (host === d.domain || host.endsWith(`.${d.domain}`)),
    );
    if (!row?.cf_zone_id || deadline?.passed()) return false;
    const purged = await purgeCacheByUrls(row.cf_zone_id, purgeUrls(host, row.domain, written), { signal: deadline?.signal });
    if (!purged.ok) console.warn(`[sedcms] apply: the Cloudflare purge for ${host} failed: ${purged.message ?? "unknown"}`);
    return purged.ok;
  } catch {
    console.warn(`[sedcms] apply: the Cloudflare purge for ${host} failed`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 6. the activity log

export async function logApply(
  admin: SupabaseClient,
  leadId: string,
  entry: {
    requestId: string;
    host: string;
    paths: string[];
    outcome: "applied" | "unchanged" | "failed";
    written: string[];
    failed?: { path: string; step: string };
    /** the deadline stopped it */
    timedOut?: true;
  },
): Promise<void> {
  try {
    const { error } = await admin.from("activity_log").insert({
      user_id: null,
      action: "studio.site.cms_applied",
      entity_type: "lead",
      entity_id: leadId,
      new_value: entry,
    });
    if (error) console.warn(`[sedcms] apply: the activity log row for ${entry.requestId} was not written`);
  } catch {
    console.warn(`[sedcms] apply: the activity log row for ${entry.requestId} was not written`);
  }
}
