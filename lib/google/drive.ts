import { getAccessToken } from "@/lib/google/oauth";

const DRIVE = "https://www.googleapis.com/drive/v3";

async function authHeaders(): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await getAccessToken()}` };
}

export interface DriveDoc {
  id: string;
  name: string;
  modifiedTime: string;
}

/** List Google Docs (not folders/other files) inside a Drive folder. */
export async function listDocsInFolder(folderId: string): Promise<DriveDoc[]> {
  const q = `'${folderId}' in parents and mimeType='application/vnd.google-apps.document' and trashed=false`;
  const params = new URLSearchParams({
    q,
    fields: "files(id,name,modifiedTime)",
    orderBy: "name",
    pageSize: "100",
  });
  const res = await fetch(`${DRIVE}/files?${params.toString()}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`Drive list failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { files?: DriveDoc[] };
  return data.files ?? [];
}

/** Copy a doc, returning the new file id. */
export async function copyDoc(fileId: string, name: string): Promise<string> {
  const res = await fetch(`${DRIVE}/files/${fileId}/copy`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Drive copy failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function renameFile(fileId: string, name: string): Promise<void> {
  const res = await fetch(`${DRIVE}/files/${fileId}`, {
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
