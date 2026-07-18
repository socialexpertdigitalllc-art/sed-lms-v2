import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { unzipToMap } from "./zip";

/**
 * Deploy a site zip onto the LOCAL filesystem — the Hostinger custom-domain
 * transfer path. The LMS runs on the same Hostinger hosting account as the
 * client addon domains, so it writes the fresh files straight into the addon
 * domain's docroot (/home/{user}/domains/{domain}/public_html) rather than
 * uploading over a network API. The target is cleared first (a fresh addon
 * docroot ships a placeholder page). Zip-slip is guarded twice: by unzipToMap
 * (rejects ".." entries) AND by a resolved-path containment check here. Returns
 * the number of files written. Server-only (node:fs).
 */
export async function deployZipToDir(zipBytes: Uint8Array, targetDir: string): Promise<{ files: number }> {
  const map = unzipToMap(zipBytes);
  const root = resolve(targetDir);
  // Replace the docroot's contents wholesale so nothing stale (a placeholder,
  // or pages removed in a regeneration) survives.
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  let files = 0;
  for (const [rel, bytes] of Object.entries(map)) {
    const dest = resolve(root, rel);
    if (dest !== root && !dest.startsWith(root + sep)) {
      throw new Error(`Unsafe path escapes target: ${rel}`);
    }
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
    files++;
  }
  return { files };
}
