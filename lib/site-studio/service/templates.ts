import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompiledTemplate, FileMap, TemplateManifest } from "../schema";
import { unzipToMap } from "../zip";
import { contentTypeFor } from "./contentType";

export const STUDIO_BUCKET = "studio-templates";

export const sourcePath = (id: string) => `${id}/source.zip`;
export const INDEX_PATH = (id: string) => `${id}/package/index.json`;
export const packageFilePath = (id: string, kind: "pages" | "fragments" | "assets", file: string) =>
  `${id}/package/${kind}/${file}`;

export interface PackageIndex { pages: string[]; fragments: string[]; assets: string[] }

export function packageIndex(tpl: CompiledTemplate): PackageIndex {
  return {
    pages: Object.keys(tpl.pages),
    fragments: Object.keys(tpl.fragments),
    assets: Object.keys(tpl.assets),
  };
}

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: ArrayBuffer | Uint8Array) => new TextDecoder().decode(b instanceof Uint8Array ? b : new Uint8Array(b));

async function uploadBatch(admin: SupabaseClient, entries: [string, Uint8Array][]): Promise<void> {
  for (let i = 0; i < entries.length; i += 8) {
    const results = await Promise.all(
      entries.slice(i, i + 8).map(([path, data]) =>
        admin.storage.from(STUDIO_BUCKET).upload(path, data, { contentType: contentTypeFor(path), upsert: true })),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) throw new Error(`Package upload failed: ${failed.error.message}`);
  }
}

/** Persist a compiled package's FILES (manifest goes to the DB row, not here). */
export async function savePackage(admin: SupabaseClient, id: string, tpl: CompiledTemplate): Promise<void> {
  const entries: [string, Uint8Array][] = [
    [INDEX_PATH(id), enc(JSON.stringify(packageIndex(tpl)))],
    ...Object.entries(tpl.pages).map(([f, html]): [string, Uint8Array] => [packageFilePath(id, "pages", f), enc(html)]),
    ...Object.entries(tpl.fragments).map(([f, html]): [string, Uint8Array] => [packageFilePath(id, "fragments", f), enc(html)]),
    ...Object.entries(tpl.assets).map(([f, bytes]): [string, Uint8Array] => [packageFilePath(id, "assets", f), bytes]),
  ];
  await uploadBatch(admin, entries);
}

async function download(admin: SupabaseClient, path: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from(STUDIO_BUCKET).download(path);
  if (error || !data) throw new Error(`Storage download failed for ${path}: ${error?.message ?? "no data"}`);
  return new Uint8Array(await data.arrayBuffer());
}

/** Rehydrate a CompiledTemplate from storage + the DB row's manifest. */
export async function loadPackage(admin: SupabaseClient, id: string, manifest: TemplateManifest): Promise<CompiledTemplate> {
  const index = JSON.parse(dec(await download(admin, INDEX_PATH(id)))) as PackageIndex;
  const pages: Record<string, string> = {};
  const fragments: Record<string, string> = {};
  const assets: FileMap = {};
  for (const f of index.pages) pages[f] = dec(await download(admin, packageFilePath(id, "pages", f)));
  for (const f of index.fragments) fragments[f] = dec(await download(admin, packageFilePath(id, "fragments", f)));
  for (const f of index.assets) assets[f] = await download(admin, packageFilePath(id, "assets", f));
  return { manifest, pages, fragments, assets };
}

/** The original upload, as a FileMap (for verifyTemplate and /original serving). */
export async function loadSourceMap(admin: SupabaseClient, id: string): Promise<FileMap> {
  return unzipToMap(await download(admin, sourcePath(id)));
}

/** Remove everything this template owns in storage (delete/replace flows). */
export async function removeAllFiles(admin: SupabaseClient, id: string): Promise<void> {
  // Storage list() is folder-scoped. A template package is dozens of files,
  // not thousands, so a two-level walk with a high limit is enough.
  const paths: string[] = [sourcePath(id), INDEX_PATH(id)];
  for (const kind of ["pages", "fragments", "assets"] as const) {
    const base = `${id}/package/${kind}`;
    const { data } = await admin.storage.from(STUDIO_BUCKET).list(base, { limit: 1000 });
    for (const f of data ?? []) {
      if (f.id === null) {
        // folder entry (e.g. css/, img/) — list one level down
        const { data: sub } = await admin.storage.from(STUDIO_BUCKET).list(`${base}/${f.name}`, { limit: 1000 });
        for (const s of sub ?? []) paths.push(`${base}/${f.name}/${s.name}`);
      } else {
        paths.push(`${base}/${f.name}`);
      }
    }
  }
  await admin.storage.from(STUDIO_BUCKET).remove(paths);
}
