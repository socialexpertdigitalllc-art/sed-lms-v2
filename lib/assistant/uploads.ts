import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { UPLOAD_PREFIX } from "./actions/fields";

/**
 * Files people drop into the chat (a logo, ticket screenshots). Kept in a
 * PRIVATE bucket, owned by the person who attached them, until an action
 * puts them where they belong — a lead's logo, a ticket item's images.
 * SERVER ONLY.
 */

export const UPLOAD_BUCKET = "assistant-uploads";
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "application/pdf", "text/plain", "text/csv"];

export interface UploadRow {
  id: string;
  user_id: string;
  conversation_id: string | null;
  path: string;
  name: string;
  mime: string;
  size_bytes: number;
  created_at: string;
}

export function cleanFileName(name: string): string {
  const base = name.replace(/[/\\]/g, "_").replace(/[^\w.\- ()]+/g, "").trim();
  return (base || "file").slice(0, 120);
}

export async function saveUpload(
  admin: SupabaseClient,
  userId: string,
  conversationId: string | null,
  file: { name: string; type: string; bytes: ArrayBuffer },
): Promise<UploadRow> {
  const name = cleanFileName(file.name);
  const path = `${userId}/${randomUUID()}-${name}`;
  const { error } = await admin.storage.from(UPLOAD_BUCKET).upload(path, file.bytes, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  const { data, error: rowError } = await admin
    .from("assistant_uploads")
    .insert({ user_id: userId, conversation_id: conversationId, path, name, mime: file.type, size_bytes: file.bytes.byteLength })
    .select("id, user_id, conversation_id, path, name, mime, size_bytes, created_at")
    .single();
  if (rowError || !data) {
    await admin.storage.from(UPLOAD_BUCKET).remove([path]).catch(() => {});
    throw new Error(rowError?.message ?? "Could not save the file");
  }
  return data as UploadRow;
}

export async function getUpload(admin: SupabaseClient, userId: string, id: string): Promise<UploadRow | null> {
  const { data } = await admin
    .from("assistant_uploads")
    .select("id, user_id, conversation_id, path, name, mime, size_bytes, created_at")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as UploadRow | null) ?? null;
}

/** The file's bytes (for re-uploading it as a ticket attachment). */
export async function readUpload(admin: SupabaseClient, userId: string, id: string): Promise<{ row: UploadRow; blob: Blob }> {
  const row = await getUpload(admin, userId, id);
  if (!row) throw new Error("That attached file is gone.");
  const { data, error } = await admin.storage.from(UPLOAD_BUCKET).download(row.path);
  if (error || !data) throw new Error(error?.message ?? "Could not read the attached file.");
  return { row, blob: data };
}

/** A short-lived link the browser (or a vision model) can open. */
export async function signedUploadUrl(admin: SupabaseClient, row: Pick<UploadRow, "path">, seconds = 3600): Promise<string | null> {
  const { data } = await admin.storage.from(UPLOAD_BUCKET).createSignedUrl(row.path, seconds);
  return data?.signedUrl ?? null;
}

/**
 * A public link for an attached image that has to live on a page (a lead's
 * logo): copied into the public branding bucket under lead-assets/.
 */
export async function publishUpload(admin: SupabaseClient, userId: string, id: string): Promise<string> {
  const { row, blob } = await readUpload(admin, userId, id);
  const path = `lead-assets/${randomUUID()}-${row.name}`;
  const { error } = await admin.storage.from("branding").upload(path, blob, { contentType: row.mime, upsert: false });
  if (error) throw new Error(error.message);
  return admin.storage.from("branding").getPublicUrl(path).data.publicUrl;
}

/** An attachment field's value as a web address: links pass through, chat files are published. */
export async function attachmentUrl(admin: SupabaseClient, userId: string, value: unknown): Promise<string | null> {
  if (typeof value !== "string" || !value) return null;
  if (value.startsWith(UPLOAD_PREFIX)) return publishUpload(admin, userId, value.slice(UPLOAD_PREFIX.length));
  return value;
}
