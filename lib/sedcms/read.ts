import { createHash } from "node:crypto";
import type { NextResponse } from "next/server";
import { SiteFilesError, type SiteFiles, type SiteRefusal } from "./files";
import { sedcmsError } from "./http";
import { cmsPathAllowed, isTextPath } from "./paths";

/**
 * What the CMS's importer and its "Check" read from a live site. SERVER ONLY.
 * The answers follow "The CMS <-> LMS contract" exactly.
 */

export const LIVE_FILES_MAX_DEPTH = 4;
export const LIVE_FILES_MAX_ENTRIES = 5000;
export const TEXT_MAX_BYTES = 1024 * 1024;
export const TEXT_TOTAL_MAX_BYTES = 25 * 1024 * 1024;
/** The text's size once written as JSON, kept well under the CMS's 40 MiB
 *  answer cap whatever the escaping costs. */
const TEXT_TOTAL_MAX_JSON_BYTES = 36 * 1024 * 1024;
/** A live file is read whole to hash it; past this the read is refused. */
export const HASH_READ_MAX_BYTES = 64 * 1024 * 1024;
export const CHECKSUMS_MAX_PATHS = 100;

export const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export interface LiveFile {
  path: string;
  size: number;
  sha256: string | null;
  text?: string;
}

/** A refusal from siteFilesFor, as the contract's answer: reads say why
 *  (403 PROTECTED, 422 NOT_STATIC); an apply answers both as 422 REFUSED. */
export function siteRefusalResponse(r: SiteRefusal, mode: "read" | "apply" = "read"): NextResponse {
  switch (r.code) {
    case "PROTECTED":
      return mode === "read"
        ? sedcmsError(403, "PROTECTED", "That is a protected company domain.")
        : sedcmsError(422, "REFUSED", "That is a protected company domain.");
    case "NOT_STATIC":
      return mode === "read"
        ? sedcmsError(422, "NOT_STATIC", "That website is not a static site the CMS can edit.")
        : sedcmsError(422, "REFUSED", "That website is not a static site the CMS can edit.");
    case "HOSTING_PENDING":
      return sedcmsError(502, "HOSTING", "The website is still being set up on the hosting; try again shortly.");
    default:
      return sedcmsError(502, "HOSTING", "The hosting could not be reached.");
  }
}

/** A SiteFilesError as a 502 HOSTING naming the path and the step, nothing more. */
export function hostingFailure(e: unknown, fallbackPath: string | null, extra: Record<string, unknown> = {}): NextResponse {
  const step = e instanceof SiteFilesError ? e.step : "read";
  const path = e instanceof SiteFilesError && e.path ? e.path : fallbackPath;
  console.warn(`[sedcms] hosting ${step} failed${path ? ` for ${path}` : ""}: ${e instanceof Error ? e.message : "unknown error"}`);
  return sedcmsError(502, "HOSTING", `The hosting failed while trying to ${step} a file.`, {
    ...extra,
    ...(path ? { failed: { path, step } } : {}),
  });
}

/**
 * Every file of the site to depth 4 (at most 5000, never a .zip or a hidden
 * name), with its size; the text and sha256 of each text file up to 1 MiB,
 * 25 MiB in all. Past the total, or past the listing's cap, truncated is true
 * and the remaining text files carry neither. A text file that isn't UTF-8,
 * or whose path the CMS could never write, carries no text.
 */
export async function liveFiles(files: SiteFiles): Promise<{ files: LiveFile[]; truncated: boolean }> {
  const listing = await files.list(LIVE_FILES_MAX_DEPTH, LIVE_FILES_MAX_ENTRIES);
  let truncated = listing.truncated;
  let used = 0;
  let usedJson = 0;
  let exhausted = false;
  const out: LiveFile[] = [];

  for (const f of listing.files) {
    if (f.path.toLowerCase().endsWith(".zip")) continue;
    const entry: LiveFile = { path: f.path, size: f.size ?? 0, sha256: null };
    const wanted = isTextPath(f.path) && cmsPathAllowed(f.path) && (f.size === null || f.size <= TEXT_MAX_BYTES);
    if (!wanted) {
      out.push(entry);
      continue;
    }
    if (exhausted || (f.size !== null && used + f.size > TEXT_TOTAL_MAX_BYTES)) {
      exhausted = truncated = true;
      out.push(entry);
      continue;
    }

    let bytes: Uint8Array | null;
    try {
      bytes = await files.read(f.path, TEXT_MAX_BYTES);
    } catch (e) {
      if (e instanceof SiteFilesError && e.reason === "too_large") {
        out.push(entry); // over 1 MiB after all (a listing without sizes)
        continue;
      }
      throw e;
    }
    if (bytes === null) continue; // gone between the listing and the read

    let text: string | undefined;
    try {
      text = strictUtf8.decode(bytes);
    } catch {
      text = undefined;
    }
    const jsonBytes = text === undefined ? 0 : Buffer.byteLength(JSON.stringify(text), "utf8");
    if (used + bytes.length > TEXT_TOTAL_MAX_BYTES || usedJson + jsonBytes > TEXT_TOTAL_MAX_JSON_BYTES) {
      exhausted = truncated = true;
      out.push({ ...entry, size: bytes.length });
      continue;
    }
    used += bytes.length;
    usedJson += jsonBytes;
    out.push(text === undefined ? { path: f.path, size: bytes.length, sha256: sha256Hex(bytes) } : { path: f.path, size: bytes.length, sha256: sha256Hex(bytes), text });
  }
  return { files: out, truncated };
}

/** Each path's live sha256, null where there is no such file, in the order asked. */
export async function checksums(files: SiteFiles, paths: string[]): Promise<{ path: string; sha256: string | null }[]> {
  const out: { path: string; sha256: string | null }[] = [];
  for (const path of paths) {
    const bytes = await files.read(path, HASH_READ_MAX_BYTES);
    out.push({ path, sha256: bytes === null ? null : sha256Hex(bytes) });
  }
  return out;
}
