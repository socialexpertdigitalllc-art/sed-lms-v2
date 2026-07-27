import type { SupabaseClient } from "@supabase/supabase-js";
import { unzipToMap } from "@/lib/site-studio/zip";

/**
 * Template storage for Site Builder.
 *
 * Deliberately shallow: on upload, the ONLY thing inspected about a
 * template's HTML is which entries end in `.html` (pages, handed whole to
 * the AI) versus everything else (assets, copied through untouched). No
 * tokenizing, no manifest, no structural analysis — see AGENTS.md's hard
 * scope limits for why.
 */

export const BUILDER_TEMPLATES_BUCKET = "builder-templates";

export const sourcePath = (id: string) => `${id}/source.zip`;

export interface BuilderTemplateRow {
  id: string;
  name: string;
  storage_path: string;
  page_files: string[];
  asset_files: string[];
  created_by: string | null;
  created_at: string;
}

/** Pure: split a zip's flat file map into page files (.html) and asset
 *  files (everything else). Case-insensitive on the extension. */
export function splitPagesAndAssets(files: Record<string, Uint8Array>): {
  pageFiles: string[];
  assetFiles: string[];
} {
  const pageFiles: string[] = [];
  const assetFiles: string[] = [];
  for (const path of Object.keys(files)) {
    if (/\.html?$/i.test(path)) pageFiles.push(path);
    else assetFiles.push(path);
  }
  pageFiles.sort();
  assetFiles.sort();
  return { pageFiles, assetFiles };
}

export interface StoreTemplateInput {
  name: string;
  bytes: Uint8Array;
  createdBy?: string | null;
}

/** Upload a template zip and record which entries are pages vs assets. */
export async function storeTemplate(
  admin: SupabaseClient,
  input: StoreTemplateInput,
): Promise<BuilderTemplateRow> {
  const id = crypto.randomUUID();
  const path = sourcePath(id);

  const map = unzipToMap(input.bytes);
  const { pageFiles, assetFiles } = splitPagesAndAssets(map);
  if (pageFiles.length === 0) {
    throw new Error("This zip has no .html pages — a template needs at least one page.");
  }

  const { error: upErr } = await admin.storage
    .from(BUILDER_TEMPLATES_BUCKET)
    .upload(path, input.bytes, { contentType: "application/zip", upsert: false });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

  const { data: row, error: insErr } = await admin
    .from("builder_templates")
    .insert({
      id,
      name: input.name,
      storage_path: path,
      page_files: pageFiles,
      asset_files: assetFiles,
      created_by: input.createdBy ?? null,
    })
    .select("*")
    .single();
  if (insErr || !row) {
    await admin.storage.from(BUILDER_TEMPLATES_BUCKET).remove([path]);
    throw new Error(insErr?.message ?? "Could not save the template record.");
  }
  return row as BuilderTemplateRow;
}

export async function listTemplates(admin: SupabaseClient): Promise<BuilderTemplateRow[]> {
  const { data, error } = await admin
    .from("builder_templates")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as BuilderTemplateRow[];
}

export async function deleteTemplate(admin: SupabaseClient, id: string): Promise<void> {
  const { data: row, error: fetchErr } = await admin
    .from("builder_templates")
    .select("storage_path")
    .eq("id", id)
    .single();
  if (fetchErr || !row) throw new Error("Template not found");

  const { error: delErr } = await admin.from("builder_templates").delete().eq("id", id);
  if (delErr) throw new Error(delErr.message);

  await admin.storage.from(BUILDER_TEMPLATES_BUCKET).remove([row.storage_path as string]);
}

export interface TemplateBundle {
  /** file -> HTML text */
  pages: Record<string, string>;
  /** file -> raw bytes, copied through untouched */
  assets: Record<string, Uint8Array>;
  pageFiles: string[];
  assetFiles: string[];
}

/** Download and unzip a template's source, ready for generation. Re-derives
 *  the page/asset split from the zip itself (not the DB row's cached lists)
 *  so it can never drift from what is actually in storage. */
export async function loadTemplateBundle(admin: SupabaseClient, id: string): Promise<TemplateBundle> {
  const { data, error } = await admin.storage.from(BUILDER_TEMPLATES_BUCKET).download(sourcePath(id));
  if (error || !data) throw new Error(`Could not load template ${id}: ${error?.message ?? "no data"}`);

  const bytes = new Uint8Array(await data.arrayBuffer());
  const map = unzipToMap(bytes);
  const { pageFiles, assetFiles } = splitPagesAndAssets(map);

  const decoder = new TextDecoder();
  const pages: Record<string, string> = {};
  for (const f of pageFiles) pages[f] = decoder.decode(map[f]);
  const assets: Record<string, Uint8Array> = {};
  for (const f of assetFiles) assets[f] = map[f];

  return { pages, assets, pageFiles, assetFiles };
}
