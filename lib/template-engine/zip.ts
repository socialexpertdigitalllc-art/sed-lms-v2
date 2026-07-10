import { unzipSync, zipSync } from "fflate";

/**
 * Unzip bytes into a normalized path->bytes map.
 * - forward slashes only
 * - directory entries dropped
 * - a single common root folder (e.g. "my-template/") is stripped when every entry shares it
 * - entries containing ".." are rejected (zip-slip guard)
 */
export function unzipToMap(bytes: Uint8Array): Record<string, Uint8Array> {
  const raw = unzipSync(bytes);
  const entries: [string, Uint8Array][] = [];

  for (const [name, data] of Object.entries(raw)) {
    const normalized = name.replace(/\\/g, "/");
    if (normalized.endsWith("/")) continue; // directory entry
    const parts = normalized.split("/").filter((p) => p.length > 0 && p !== ".");
    if (parts.length === 0) continue;
    if (parts.includes("..")) throw new Error(`Unsafe path in zip entry: ${name}`);
    entries.push([parts.join("/"), data]);
  }

  // strip a single shared root folder if every entry lives under the same one
  if (entries.length > 0) {
    const first = entries[0][0].split("/")[0];
    const allShareRoot = entries.every(([path]) => {
      const segs = path.split("/");
      return segs.length >= 2 && segs[0] === first;
    });
    if (allShareRoot) {
      for (const entry of entries) entry[0] = entry[0].split("/").slice(1).join("/");
    }
  }

  const out: Record<string, Uint8Array> = {};
  for (const [path, data] of entries) out[path] = data;
  return out;
}

/** Zip a path->bytes map with default compression. */
export function zipFromMap(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files);
}
