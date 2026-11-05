/**
 * Pure naming helpers for the hero video library. Unit tested
 * (tests/heroVideos.test.ts).
 */

/** "Kitchen Remodel 2.mp4" -> "Kitchen Remodel 2". */
export function displayName(fileName: string): string {
  const base = fileName.trim().replace(/\.[a-z0-9]{2,4}$/i, "").trim();
  return base || fileName.trim() || "Video";
}

/**
 * The file name a video gets on the media host: a readable slug of its name
 * plus the head of its Drive id, so two "Kitchen Remodel.mp4" files in
 * different folders never land on one URL. Stable for a given file: a re-sync
 * of a changed video overwrites the same URL, and every site using it gets the
 * new cut.
 */
export function mediaFileName(name: string, driveFileId: string): string {
  const slug =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "video";
  const id = driveFileId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12);
  return `${slug}-${id}.mp4`;
}

/**
 * Accept a Drive FILE id or any of the links people copy for one:
 *   https://drive.google.com/file/d/<id>/view?usp=sharing
 *   https://drive.google.com/open?id=<id>
 *   https://drive.google.com/uc?export=download&id=<id>
 *   https://drive.usercontent.google.com/download?id=<id>&export=download
 * Returns "" when nothing id-shaped is in it.
 */
export function driveFileIdFrom(input: string): string {
  const s = (input ?? "").trim();
  if (!s) return "";
  const path = s.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/);
  if (path) return path[1];
  const param = s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (param) return param[1];
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s;
  return "";
}

/** True for a pasted FOLDER link — the right answer for settings, the wrong one for a single video. */
export function isDriveFolderLink(input: string): boolean {
  return /\/folders\/[A-Za-z0-9_-]{10,}/.test(input ?? "");
}

/**
 * The gallery filter a lead's own category opens on, if the library has a
 * matching one: exact (case-insensitive) first, then a category whose name
 * contains the lead's ("Remodeling" finds nothing, "Roofing" finds "Roofing",
 * "Decking" finds "Decks" by stem). Null when nothing fits — the gallery then
 * opens on "All".
 */
export function matchCategory(leadCategory: string | null | undefined, categories: string[]): string | null {
  const want = (leadCategory ?? "").trim().toLowerCase();
  if (!want) return null;
  const exact = categories.find((c) => c.toLowerCase() === want);
  if (exact) return exact;
  const stem = want.replace(/(ing|s)$/, "");
  if (stem.length < 4) return null;
  return categories.find((c) => c.toLowerCase().includes(stem)) ?? null;
}

/** "1:05" style duration for the gallery. */
export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return "";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
