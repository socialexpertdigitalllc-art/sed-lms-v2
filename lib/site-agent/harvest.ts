// lib/site-agent/harvest.ts
import {
  MAX_CHANGED_FILES, MAX_FILE_BYTES, MAX_RESULT_BYTES, type AgentFileChange,
} from "./types";

export type HarvestOutcome =
  | { ok: true; changes: Record<string, AgentFileChange>; resultMap: Record<string, Uint8Array> }
  | { ok: false; error: string };

/** Forward-slash relative paths only — the same shape unzipToMap produces.
 *  Anything else in the edited map means the agent (or the fs walk) escaped. */
function isSafeRelPath(p: string): boolean {
  if (!p || p.includes("\\") || p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return false;
  return !p.split("/").some((seg) => seg === ".." || seg === "" || seg === ".");
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
  if (!Object.keys(edited).some((n) => /^index\.html?$/i.test(n))) {
    return { ok: false, error: "The agent removed index.html — the site would not be deployable. Refused." };
  }

  const changes: Record<string, AgentFileChange> = {};
  let totalBytes = 0;
  for (const [path, bytes] of Object.entries(edited)) {
    totalBytes += bytes.byteLength;
    const before = original[path];
    if (!before) changes[path] = { action: "create", bytes: bytes.byteLength };
    else if (!sameBytes(before, bytes)) changes[path] = { action: "edit", bytes: bytes.byteLength };
    if (bytes.byteLength > MAX_FILE_BYTES) {
      return { ok: false, error: `"${path}" is too large (${bytes.byteLength} bytes; per-file cap ${MAX_FILE_BYTES}).` };
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

  return { ok: true, changes, resultMap: edited };
}
