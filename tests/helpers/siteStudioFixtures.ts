import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { zipSync } from "fflate";

const ROOT = path.resolve(__dirname, "../fixtures/site-studio");

/** Read a fixture directory into a path→bytes map (forward slashes). */
export function fixtureFiles(name: string): Record<string, Uint8Array> {
  const base = path.join(ROOT, name);
  const out: Record<string, Uint8Array> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out[path.relative(base, full).replace(/\\/g, "/")] = new Uint8Array(readFileSync(full));
    }
  };
  walk(base);
  return out;
}

/** Zip a fixture directory in-memory, as if an operator uploaded it. */
export function fixtureZip(name: string): Uint8Array {
  return zipSync(fixtureFiles(name));
}

export const text = (b: Uint8Array) => new TextDecoder().decode(b);
