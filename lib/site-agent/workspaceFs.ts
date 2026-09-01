// lib/site-agent/workspaceFs.ts
/** Real scratch-dir workspace for the worker box. Paths stay inside
 *  {tmpdir}/sed-agent/{key} (key = claim-scoped "<runId>-<claim8>", see
 *  lib/site-agent/worker.ts); collect() re-walks and returns forward-slash
 *  relative paths so harvest sees the same shape unzipToMap produces. */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import type { Workspace } from "./worker";

const root = () => join(tmpdir(), "sed-agent");

function dirFor(key: string): string {
  const d = resolve(root(), key);
  if (!d.startsWith(resolve(root()) + sep)) throw new Error("workspace path escape");
  return d;
}

async function walk(dir: string, base: string, out: Record<string, Uint8Array>): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await walk(full, base, out);
    else out[full.slice(base.length + 1).replaceAll(sep, "/")] = new Uint8Array(await readFile(full));
  }
}

export const fsWorkspace: Workspace = {
  async materialize(map, key) {
    const dir = dirFor(key);
    await rm(dir, { recursive: true, force: true });
    for (const [rel, bytes] of Object.entries(map)) {
      const target = resolve(dir, rel);
      if (!target.startsWith(dir + sep)) continue; // zip layer already guards; belt+braces
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    return dir;
  },
  async collect(key) {
    const dir = dirFor(key);
    const out: Record<string, Uint8Array> = {};
    await walk(dir, dir, out);
    return out;
  },
  async cleanup(key) {
    await rm(dirFor(key), { recursive: true, force: true });
  },
};
