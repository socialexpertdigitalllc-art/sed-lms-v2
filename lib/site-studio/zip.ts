import { unzipSync, zipSync } from "fflate";

/**
 * Unzip bytes into a normalized path→bytes map: forward slashes, directory
 * entries dropped, a single shared root folder stripped, ".." rejected.
 */
export function unzipToMap(bytes: Uint8Array): Record<string, Uint8Array> {
  const raw = unzipSync(bytes);
  const entries: [string, Uint8Array][] = [];
  for (const [name, data] of Object.entries(raw)) {
    const normalized = name.replace(/\\/g, "/");
    if (normalized.endsWith("/")) continue;
    const parts = normalized.split("/").filter((p) => p.length > 0 && p !== ".");
    if (parts.length === 0) continue;
    if (parts.includes("..")) throw new Error(`Unsafe path in zip entry: ${name}`);
    if (/^[A-Za-z]:$/.test(parts[0])) throw new Error(`Unsafe path in zip entry: ${name}`);
    entries.push([parts.join("/"), data]);
  }
  if (entries.length > 0) {
    const first = entries[0][0].split("/")[0];
    const allShareRoot = entries.every(([p]) => {
      const segs = p.split("/");
      return segs.length >= 2 && segs[0] === first;
    });
    if (allShareRoot) for (const e of entries) e[0] = e[0].split("/").slice(1).join("/");
  }
  const out: Record<string, Uint8Array> = {};
  for (const [p, data] of entries) {
    if (p in out) throw new Error(`Duplicate path in zip: ${p}`);
    out[p] = data;
  }
  return out;
}

export function zipFromMap(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files);
}
