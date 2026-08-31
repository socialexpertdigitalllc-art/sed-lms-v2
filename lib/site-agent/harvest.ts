// lib/site-agent/harvest.ts
import {
  MAX_CHANGED_FILES, MAX_FILE_BYTES, MAX_RESULT_BYTES, type AgentFileChange,
} from "./types";

export type HarvestOutcome =
  | { ok: true; changes: Record<string, AgentFileChange>; resultMap: Record<string, Uint8Array> }
  | { ok: false; error: string };

/** Forward-slash relative paths only — the same shape unzipToMap produces.
 *  Anything else in the edited map means the agent (or the fs walk) escaped.
 *  Also refuses names that are hazardous once materialized on a real
 *  filesystem (Task 6 writes these to disk on a Windows worker): colons
 *  (drive letters + NTFS alternate data streams), reserved device names,
 *  trailing dots/spaces (Win32 strips them silently), control chars. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
function isSafeRelPath(p: string): boolean {
  if (!p || p.includes("\\") || p.startsWith("/") || p.includes(":")) return false;
  // Refuses C0 control characters (0x00-0x1f) via code-point comparison
  // rather than a regex escape range, to avoid any ambiguity in how a
  // literal control-character escape is represented in this source file.
  if ([...p].some((ch) => ch.charCodeAt(0) < 0x20)) return false;
  return !p.split("/").some(
    (seg) =>
      seg === ".." || seg === "" || seg === "." ||
      WINDOWS_RESERVED.test(seg) || /[. ]$/.test(seg),
  );
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The export channel: what changed is decided by comparing the workspace
 * AFTER the agent ran against the original site map — never by trusting the
 * agent's own account of its work. Returns the cumulative change list plus
 * the full deployable result map.
 */
export function harvestChanges(
  original: Record<string, Uint8Array>,
  edited: Record<string, Uint8Array>,
): HarvestOutcome {
  for (const p of Object.keys(edited)) {
    if (!isSafeRelPath(p)) return { ok: false, error: `Unsafe path in the agent's output: "${p}"` };
  }
  // The root index must SURVIVE: matched against the exact filenames the
  // original actually had, so a case-rename (index.html -> INDEX.HTML) counts
  // as removal on a case-sensitive host. Originals always have one
  // (prepareSiteZip refuses zips without it), but fall back to a presence
  // check just in case.
  const rootIndexes = Object.keys(original).filter((n) => /^index\.html?$/i.test(n));
  const missingIndex = rootIndexes.find((n) => !(n in edited));
  if (missingIndex !== undefined ||
      (rootIndexes.length === 0 && !Object.keys(edited).some((n) => /^index\.html?$/i.test(n)))) {
    return { ok: false, error: `The agent removed ${missingIndex ?? "index.html"} — the site would not be deployable. Refused.` };
  }

  const changes: Record<string, AgentFileChange> = {};
  let totalBytes = 0;
  for (const [path, bytes] of Object.entries(edited)) {
    totalBytes += bytes.byteLength;
    const before = original[path];
    const change: AgentFileChange | null = !before
      ? { action: "create", bytes: bytes.byteLength }
      : !sameBytes(before, bytes)
        ? { action: "edit", bytes: bytes.byteLength }
        : null;
    if (change) {
      // The cap gates what the AGENT produced. A pre-existing oversized
      // asset (hero video, photo) it never touched must not block an
      // unrelated edit — sameBytes short-circuits on length, so unchanged
      // big files cost only a length check.
      if (bytes.byteLength > MAX_FILE_BYTES) {
        return { ok: false, error: `"${path}" is too large (${bytes.byteLength} bytes; per-file cap ${MAX_FILE_BYTES}).` };
      }
      changes[path] = change;
    }
  }
  for (const path of Object.keys(original)) {
    if (!(path in edited)) changes[path] = { action: "delete", bytes: 0 };
  }

  const changed = Object.keys(changes).length;
  if (changed === 0) return { ok: false, error: "The agent made no changes to the site." };
  if (changed > MAX_CHANGED_FILES) {
    return { ok: false, error: `Too many changed files (${changed}; cap ${MAX_CHANGED_FILES}) — this does not look like a ticket-sized change.` };
  }
  if (totalBytes > MAX_RESULT_BYTES) {
    return { ok: false, error: `The edited site is too large (${totalBytes} bytes; cap ${MAX_RESULT_BYTES}).` };
  }

  // resultMap intentionally aliases `edited` (no copy of up to 50MB);
  // callers must treat it as read-only.
  return { ok: true, changes, resultMap: edited };
}
