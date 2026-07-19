import { getAccessToken } from "@/lib/google/oauth";

const DRIVE = "https://www.googleapis.com/drive/v3";

/** Native Google Doc — the only type we can copy + placeholder-fill + export. */
export const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

/** Include files that live in (or are shared from) shared drives. */
const ALL_DRIVES = { supportsAllDrives: "true", includeItemsFromAllDrives: "true" };

async function authHeaders(): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await getAccessToken()}` };
}

export interface DriveDoc {
  id: string;
  name: string;
  modifiedTime: string;
}

export interface DriveFile extends DriveDoc {
  mimeType: string;
}

/**
 * Accept either a bare folder id or a pasted Drive URL. Operators naturally
 * copy the address bar (".../folders/<id>?usp=sharing"), which would otherwise
 * be stored verbatim and match nothing. Pure — unit tested.
 */
export function normalizeFolderId(input: string): string {
  const s = (input ?? "").trim();
  if (!s) return "";
  const folder = s.match(/\/folders\/([A-Za-z0-9_-]+)/);
  if (folder) return folder[1];
  const idParam = s.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (idParam) return idParam[1];
  return s.replace(/[?#].*$/, "").replace(/\/+$/, "");
}

/**
 * Folder metadata, or null when the connected Google account cannot see it
 * (404/403). This is what separates "folder is empty" from "wrong account /
 * not shared" — the two failure modes look identical from a file list alone.
 */
export async function getFolderMeta(folderId: string): Promise<{ id: string; name: string } | null> {
  const params = new URLSearchParams({ fields: "id,name,mimeType", supportsAllDrives: "true" });
  const res = await fetch(`${DRIVE}/files/${folderId}?${params.toString()}`, { headers: await authHeaders() });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`Drive folder lookup failed: ${res.status} ${await res.text()}`);
  const d = (await res.json()) as { id: string; name: string };
  return { id: d.id, name: d.name };
}

/** Every non-trashed file in the folder, ANY type, so the UI can explain what it found. */
export async function listFolderFiles(folderId: string): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed=false`,
    fields: "files(id,name,mimeType,modifiedTime)",
    orderBy: "name",
    pageSize: "200",
    ...ALL_DRIVES,
  });
  const res = await fetch(`${DRIVE}/files?${params.toString()}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`Drive list failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { files?: DriveFile[] };
  return data.files ?? [];
}

/** List only the native Google Docs inside a folder. */
export async function listDocsInFolder(folderId: string): Promise<DriveDoc[]> {
  const files = await listFolderFiles(folderId);
  return files.filter((f) => f.mimeType === GOOGLE_DOC_MIME).map(({ id, name, modifiedTime }) => ({ id, name, modifiedTime }));
}

/**
 * Copy a doc, returning the new file id. When `parentFolderId` is given the copy
 * is created inside that folder; otherwise Drive defaults to the source file's
 * folder (which for contracts would pollute the templates folder).
 */
export async function copyDoc(fileId: string, name: string, parentFolderId?: string): Promise<string> {
  const params = new URLSearchParams({ supportsAllDrives: "true" });
  const body: { name: string; parents?: string[] } = { name };
  if (typeof parentFolderId === "string" && parentFolderId.trim()) body.parents = [parentFolderId.trim()];
  const res = await fetch(`${DRIVE}/files/${fileId}/copy?${params.toString()}`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Drive copy failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function renameFile(fileId: string, name: string): Promise<void> {
  const params = new URLSearchParams({ supportsAllDrives: "true" });
  const res = await fetch(`${DRIVE}/files/${fileId}?${params.toString()}`, {
    method: "PATCH",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Drive rename failed: ${res.status} ${await res.text()}`);
}

/** Export a Google Doc as PDF bytes. */
export async function exportPdf(fileId: string): Promise<Uint8Array> {
  const res = await fetch(`${DRIVE}/files/${fileId}/export?mimeType=application/pdf`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Drive export failed: ${res.status} ${await res.text()}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Human-facing edit URL for a generated doc. */
export function docUrl(fileId: string): string {
  return `https://docs.google.com/document/d/${fileId}/edit`;
}
