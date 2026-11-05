import type { SupabaseClient } from "@supabase/supabase-js";
import { getGoogleConnection } from "@/lib/google/connection";
import { copyIntoFolder, downloadDriveFile, ensureCategoryFolder, getDriveFile, isVideoMime, listLibrary } from "./drive";
import { checkHeroVideoUrl, uploadHeroVideo } from "./mediaHost";
import { displayName, driveFileIdFrom, isDriveFolderLink, mediaFileName } from "./names";

/**
 * The hero video library: Drive folder (source) → media host (one playable
 * copy) → `hero_videos` rows (the catalogue the lead form's gallery shows).
 * See supabase/migrations/0097_hero_videos.sql for the data model.
 */

export interface HeroVideoRow {
  id: string;
  drive_file_id: string;
  name: string;
  category: string;
  drive_folder_id: string | null;
  drive_modified_time: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  media_path: string | null;
  media_url: string | null;
  status: "pending" | "ready" | "failed" | "archived";
  error: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

/** What the gallery needs — nothing about Drive. */
export interface HeroVideoCard {
  id: string;
  name: string;
  category: string;
  media_url: string;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
}

/** A hero background loops a few seconds; anything this big was not compressed. */
export const HERO_VIDEO_MAX_BYTES = 80 * 1024 * 1024;

/** A row whose media copy exists — archived ones too: sites built with them still play them. */
export const usable = (r: Pick<HeroVideoRow, "status" | "media_url"> | null | undefined): boolean =>
  !!r && !!r.media_url && (r.status === "ready" || r.status === "archived");

const now = () => new Date().toISOString();

export function toCard(r: HeroVideoRow): HeroVideoCard {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    media_url: r.media_url ?? "",
    duration_ms: r.duration_ms,
    width: r.width,
    height: r.height,
  };
}

export async function getLibraryFolderId(admin: SupabaseClient): Promise<string | null> {
  const { data } = await admin.from("app_settings").select("hero_videos_folder_id").eq("singleton", true).maybeSingle();
  const id = (data as { hero_videos_folder_id?: string | null } | null)?.hero_videos_folder_id;
  return id && id.trim() ? id.trim() : null;
}

export async function listHeroVideos(admin: SupabaseClient, opts: { all?: boolean } = {}): Promise<HeroVideoRow[]> {
  let q = admin.from("hero_videos").select("*").order("category").order("name");
  if (!opts.all) q = q.eq("status", "ready");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as HeroVideoRow[];
}

export async function getHeroVideo(admin: SupabaseClient, id: string): Promise<HeroVideoRow | null> {
  const { data } = await admin.from("hero_videos").select("*").eq("id", id).maybeSingle();
  return (data as HeroVideoRow | null) ?? null;
}

// ---------------------------------------------------------------- sync

export interface SyncItem {
  drive_file_id: string;
  name: string;
  category: string;
  reason: "new" | "changed" | "retry";
}

export interface SyncPlan {
  folder: { id: string; name: string };
  /** Videos to copy to the media host — the client imports them one by one. */
  toImport: SyncItem[];
  upToDate: number;
  /** Names of videos gone from Drive, now hidden from the gallery. */
  archived: string[];
  /** Videos back in Drive after being archived (same file, unchanged). */
  restored: number;
  skipped: { name: string; reason: string }[];
}

/**
 * Compare the Drive folder with the catalogue. Applies the cheap changes
 * itself — archive what left Drive, restore what came back, follow renames
 * and moves between category folders — and returns what still needs copying.
 * The copying is left to `importHeroVideo`, one request per video, so a big
 * sync never sits inside one long request.
 */
export async function planSync(admin: SupabaseClient): Promise<SyncPlan> {
  const folderId = await getLibraryFolderId(admin);
  if (!folderId) throw new Error("Set the Google Drive folder of the hero video library first.");
  const listing = await listLibrary(folderId);
  const rows = await listHeroVideos(admin, { all: true });
  const byDrive = new Map(rows.map((r) => [r.drive_file_id, r]));
  const seen = new Set<string>();
  const plan: SyncPlan = { folder: listing.folder, toImport: [], upToDate: 0, archived: [], restored: 0, skipped: listing.skipped };

  for (const cat of listing.categories) {
    for (const v of cat.videos) {
      seen.add(v.id);
      const name = displayName(v.name);
      const row = byDrive.get(v.id);
      if (!row) {
        plan.toImport.push({ drive_file_id: v.id, name, category: cat.name, reason: "new" });
        continue;
      }
      if (row.status === "failed" || row.status === "pending" || !row.media_url) {
        plan.toImport.push({ drive_file_id: v.id, name, category: cat.name, reason: "retry" });
        continue;
      }
      const changed = !row.drive_modified_time || new Date(row.drive_modified_time).getTime() !== new Date(v.modifiedTime).getTime();
      if (changed) {
        plan.toImport.push({ drive_file_id: v.id, name, category: cat.name, reason: "changed" });
        continue;
      }
      const patch: Partial<HeroVideoRow> = {};
      if (row.status === "archived") {
        patch.status = "ready";
        plan.restored++;
      }
      if (row.category !== cat.name) patch.category = cat.name;
      if (row.name !== name) patch.name = name;
      if (row.drive_folder_id !== cat.id) patch.drive_folder_id = cat.id;
      if (Object.keys(patch).length) {
        await admin.from("hero_videos").update({ ...patch, updated_at: now() }).eq("id", row.id);
      }
      plan.upToDate++;
    }
  }

  const gone = rows.filter((r) => r.status !== "archived" && !seen.has(r.drive_file_id));
  if (gone.length) {
    await admin
      .from("hero_videos")
      .update({ status: "archived", updated_at: now() })
      .in("id", gone.map((r) => r.id));
    plan.archived = gone.map((r) => `${r.category} / ${r.name}`);
  }
  return plan;
}

/**
 * Copy one Drive video to the media host and record it. A row that was
 * already playable stays playable when a re-sync fails (its old copy is still
 * on the media host) — the failure is noted in `error` and the next sync
 * retries it.
 */
export async function importHeroVideo(admin: SupabaseClient, driveFileId: string, category: string): Promise<HeroVideoRow> {
  const meta = await getDriveFile(driveFileId);
  if (!meta || meta.trashed) throw new Error("The connected Google account can't open that video (moved, deleted or not shared).");
  if (!isVideoMime(meta.mimeType)) throw new Error(`"${meta.name}" is not a video file.`);

  const name = displayName(meta.name);
  const cat = category.trim() || "Uncategorized";
  const { data: existing } = await admin.from("hero_videos").select("*").eq("drive_file_id", driveFileId).maybeSingle();
  const prev = existing as HeroVideoRow | null;

  let rowId = prev?.id;
  if (!prev) {
    const { data: inserted, error } = await admin
      .from("hero_videos")
      .insert({ drive_file_id: driveFileId, name, category: cat, drive_folder_id: meta.parents[0] ?? null, status: "pending" })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(error?.message ?? "Could not record the video");
    rowId = (inserted as { id: string }).id;
  }

  try {
    const bytes = await downloadDriveFile(driveFileId, HERO_VIDEO_MAX_BYTES);
    const fileName = mediaFileName(name, driveFileId);
    const url = await uploadHeroVideo(fileName, bytes);
    const check = await checkHeroVideoUrl(url);
    if (check.error) throw new Error(check.error);
    const { data: saved, error } = await admin
      .from("hero_videos")
      .update({
        name,
        category: cat,
        drive_folder_id: meta.parents[0] ?? null,
        drive_modified_time: meta.modifiedTime,
        size_bytes: bytes.byteLength,
        width: meta.width,
        height: meta.height,
        duration_ms: meta.durationMs,
        media_path: fileName,
        media_url: url,
        status: "ready",
        error: check.warning,
        synced_at: now(),
        updated_at: now(),
      })
      .eq("id", rowId!)
      .select("*")
      .single();
    if (error || !saved) throw new Error(error?.message ?? "Could not save the video");
    return saved as HeroVideoRow;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const keepPlaying = usable(prev);
    await admin
      .from("hero_videos")
      .update({
        ...(keepPlaying ? {} : { status: "failed" }),
        error: keepPlaying ? `Last sync failed (the previous copy still plays): ${message}` : message,
        updated_at: now(),
      })
      .eq("id", rowId!);
    throw new Error(message);
  }
}

/**
 * The developer's "request new video" answer: a Drive link to one video. The
 * video is COPIED into the library's folder for `category` (created if
 * missing) and imported, so it joins the gallery for every later lead — the
 * library stays exactly what is in Drive.
 */
export async function addVideoFromLink(admin: SupabaseClient, link: string, category: string): Promise<HeroVideoRow> {
  if (isDriveFolderLink(link)) throw new Error("That is a folder link — paste the link of the video file itself.");
  const fileId = driveFileIdFrom(link);
  if (!fileId) throw new Error("Paste a Google Drive link to the video (drive.google.com/file/d/…).");
  const cat = category.trim();
  if (!cat) throw new Error("Choose the category the video belongs to.");
  const libraryId = await getLibraryFolderId(admin);
  if (!libraryId) throw new Error("Set the hero video library's Drive folder (Site Builder → Hero Videos) first.");

  const meta = await getDriveFile(fileId);
  if (!meta || meta.trashed) {
    const conn = await getGoogleConnection().catch(() => null);
    const who = conn?.account_email ? ` (${conn.account_email})` : "";
    throw new Error(`The connected Google account${who} can't open that file. Share it with that account, or set it to "Anyone with the link".`);
  }
  if (!isVideoMime(meta.mimeType)) throw new Error(`"${meta.name}" is not a video file.`);

  // Pasted twice (or already a library file): the existing row is the answer.
  const { data: known } = await admin.from("hero_videos").select("*").eq("drive_file_id", fileId).maybeSingle();
  if (usable(known as HeroVideoRow | null)) return known as HeroVideoRow;

  const folder = await ensureCategoryFolder(libraryId, cat);
  const inLibrary = meta.parents.includes(folder.id);
  const target = inLibrary ? meta : await copyIntoFolder(fileId, folder.id, meta.name);
  return importHeroVideo(admin, target.id, folder.name);
}

// ---------------------------------------------------------------- leads & templates

export async function templateHasHeroVideo(admin: SupabaseClient, templateId: string | null | undefined): Promise<{ hero: boolean; name: string } | null> {
  if (!templateId) return null;
  const { data } = await admin.from("builder_templates").select("name, hero_video").eq("id", templateId).maybeSingle();
  if (!data) return null;
  const row = data as { name: string; hero_video?: boolean | null };
  return { hero: row.hero_video === true, name: row.name };
}

export interface HeroChoice {
  hero_video_id: string | null;
  hero_video_request: boolean;
  hero_video_note: string | null;
}

/**
 * The server half of "a video-hero template needs a video": returns the
 * fields to store (cleared for any other template; no video id alongside a
 * request) or the reason the choice is refused.
 */
export async function normalizeHeroChoice(
  admin: SupabaseClient,
  templateId: string | null | undefined,
  choice: Partial<HeroChoice>,
): Promise<{ ok: true; fields: HeroChoice } | { ok: false; error: string }> {
  const template = await templateHasHeroVideo(admin, templateId);
  if (!template?.hero) return { ok: true, fields: { hero_video_id: null, hero_video_request: false, hero_video_note: null } };
  const note = typeof choice.hero_video_note === "string" ? choice.hero_video_note.trim().slice(0, 1000) || null : null;
  if (choice.hero_video_request === true) {
    return { ok: true, fields: { hero_video_id: null, hero_video_request: true, hero_video_note: note } };
  }
  if (!choice.hero_video_id) {
    return { ok: false, error: `The ${template.name} template plays a video in its hero — pick one from the gallery, or request a new video.` };
  }
  const video = await getHeroVideo(admin, choice.hero_video_id);
  if (!usable(video)) return { ok: false, error: "That hero video is no longer in the library — pick another one." };
  return { ok: true, fields: { hero_video_id: video!.id, hero_video_request: false, hero_video_note: null } };
}

/**
 * The hero video URL a run for this lead must use, or null when the template
 * has no video hero. Throws the message the run screen shows when the lead
 * has no usable video yet.
 */
export async function heroVideoUrlForRun(
  admin: SupabaseClient,
  templateId: string,
  lead: Record<string, unknown>,
): Promise<string | null> {
  const template = await templateHasHeroVideo(admin, templateId);
  if (!template?.hero) return null;
  const id = typeof lead.hero_video_id === "string" ? lead.hero_video_id : null;
  const video = id ? await getHeroVideo(admin, id) : null;
  if (usable(video)) return video!.media_url!;
  if (lead.hero_video_request === true) {
    throw new Error(`Sales requested a NEW hero video for this lead. Add the video's Google Drive link on the New Site screen (Hero video), then generate again.`);
  }
  throw new Error(`The ${template.name} template plays a video in its hero, and this lead has no hero video. Pick one on the New Site screen, then generate again.`);
}
