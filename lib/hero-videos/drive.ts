import { getAccessToken } from "@/lib/google/oauth";

/**
 * Google Drive side of the hero video library: the library is ONE folder with
 * a subfolder per category, and the videos inside them. Everything here runs
 * as the company's connected Google account (lib/google/oauth.ts, full Drive
 * scope).
 */

const DRIVE = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const ALL_DRIVES = { supportsAllDrives: "true", includeItemsFromAllDrives: "true" };
const FILE_FIELDS = "id,name,mimeType,modifiedTime,size,parents,trashed,videoMediaMetadata(width,height,durationMillis)";

export interface DriveVideo {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  parents: string[];
}

export interface LibraryListing {
  folder: { id: string; name: string };
  categories: { id: string; name: string; videos: DriveVideo[] }[];
  /** Files sitting outside a category folder, or not videos — reported, never imported. */
  skipped: { name: string; reason: string }[];
}

async function headers(): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await getAccessToken()}` };
}

interface RawFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
  parents?: string[];
  trashed?: boolean;
  videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string };
}

function toVideo(f: RawFile): DriveVideo {
  const m = f.videoMediaMetadata;
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime,
    size: f.size ? Number(f.size) : null,
    width: m?.width ?? null,
    height: m?.height ?? null,
    durationMs: m?.durationMillis ? Number(m.durationMillis) : null,
    parents: f.parents ?? [],
  };
}

export const isVideoMime = (mime: string) => mime.startsWith("video/");

/** Every non-trashed child of a folder (all pages). */
async function listChildren(folderId: string): Promise<RawFile[]> {
  const out: RawFile[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed=false`,
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      orderBy: "name",
      pageSize: "200",
      ...ALL_DRIVES,
      ...(pageToken ? { pageToken } : {}),
    });
    const res = await fetch(`${DRIVE}/files?${params.toString()}`, { headers: await headers() });
    if (!res.ok) throw new Error(`Drive list failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { files?: RawFile[]; nextPageToken?: string };
    out.push(...(data.files ?? []));
    pageToken = data.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

/** A file's metadata, or null when the connected account cannot see it. */
export async function getDriveFile(fileId: string): Promise<(DriveVideo & { trashed: boolean }) | null> {
  const params = new URLSearchParams({ fields: FILE_FIELDS, supportsAllDrives: "true" });
  const res = await fetch(`${DRIVE}/files/${encodeURIComponent(fileId)}?${params.toString()}`, { headers: await headers() });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`Drive lookup failed: ${res.status} ${await res.text()}`);
  const f = (await res.json()) as RawFile;
  return { ...toVideo(f), trashed: !!f.trashed };
}

/**
 * The library as Drive has it: each subfolder of the library folder is a
 * category, each video file in one is a library video. One level deep —
 * a folder inside a category folder is reported, not walked.
 */
export async function listLibrary(folderId: string): Promise<LibraryListing> {
  const meta = await getDriveFile(folderId);
  if (!meta || meta.mimeType !== FOLDER_MIME) {
    throw new Error(
      "The connected Google account can't open the hero videos folder. Check the folder link, and that it is shared with that account.",
    );
  }
  const top = await listChildren(folderId);
  const skipped: LibraryListing["skipped"] = [];
  const folders = top.filter((f) => f.mimeType === FOLDER_MIME);
  for (const f of top) {
    if (f.mimeType === FOLDER_MIME) continue;
    skipped.push({
      name: f.name,
      reason: isVideoMime(f.mimeType)
        ? "Not in a category folder — move it into the folder of its category."
        : "Not a video.",
    });
  }
  const categories: LibraryListing["categories"] = [];
  for (const folder of folders) {
    const children = await listChildren(folder.id);
    const videos: DriveVideo[] = [];
    for (const c of children) {
      if (isVideoMime(c.mimeType)) videos.push(toVideo(c));
      else if (c.mimeType === FOLDER_MIME) skipped.push({ name: `${folder.name}/${c.name}`, reason: "Folders inside a category are not read." });
      else skipped.push({ name: `${folder.name}/${c.name}`, reason: "Not a video." });
    }
    categories.push({ id: folder.id, name: folder.name.trim(), videos });
  }
  return { folder: { id: meta.id, name: meta.name }, categories, skipped };
}

/** Download a file's bytes, refusing anything over `maxBytes`. */
export async function downloadDriveFile(fileId: string, maxBytes: number): Promise<Uint8Array> {
  const params = new URLSearchParams({ alt: "media", supportsAllDrives: "true" });
  const res = await fetch(`${DRIVE}/files/${encodeURIComponent(fileId)}?${params.toString()}`, { headers: await headers() });
  if (!res.ok) throw new Error(`Drive download failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`The video is ${(declared / 1e6).toFixed(0)} MB; the limit is ${(maxBytes / 1e6).toFixed(0)} MB. Compress it first.`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    throw new Error(`The video is ${(buf.byteLength / 1e6).toFixed(0)} MB; the limit is ${(maxBytes / 1e6).toFixed(0)} MB. Compress it first.`);
  }
  return buf;
}

/** The category subfolder of the library with this name (case-insensitive), created when missing. */
export async function ensureCategoryFolder(libraryFolderId: string, category: string): Promise<{ id: string; name: string }> {
  const want = category.trim();
  const existing = (await listChildren(libraryFolderId)).find(
    (f) => f.mimeType === FOLDER_MIME && f.name.trim().toLowerCase() === want.toLowerCase(),
  );
  if (existing) return { id: existing.id, name: existing.name.trim() };
  const res = await fetch(`${DRIVE}/files?supportsAllDrives=true`, {
    method: "POST",
    headers: { ...(await headers()), "Content-Type": "application/json" },
    body: JSON.stringify({ name: want, mimeType: FOLDER_MIME, parents: [libraryFolderId] }),
  });
  if (!res.ok) throw new Error(`Could not create the "${want}" folder in Drive: ${res.status} ${await res.text()}`);
  const f = (await res.json()) as { id: string; name: string };
  return { id: f.id, name: f.name };
}

/** Copy a file into a folder under a new name; returns the copy's metadata. */
export async function copyIntoFolder(fileId: string, folderId: string, name: string): Promise<DriveVideo> {
  const params = new URLSearchParams({ fields: FILE_FIELDS, supportsAllDrives: "true" });
  const res = await fetch(`${DRIVE}/files/${encodeURIComponent(fileId)}/copy?${params.toString()}`, {
    method: "POST",
    headers: { ...(await headers()), "Content-Type": "application/json" },
    body: JSON.stringify({ name, parents: [folderId] }),
  });
  if (!res.ok) throw new Error(`Could not copy the video into the library: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return toVideo((await res.json()) as RawFile);
}
