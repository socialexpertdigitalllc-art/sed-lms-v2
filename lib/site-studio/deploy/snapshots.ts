import type { SupabaseClient } from "@supabase/supabase-js";
import { SITES_BUCKET } from "../run/finalize";
import { fetchLiveSiteZip, siteHostFrom } from "./liveFiles";

/**
 * Pre-override snapshots — the rollback safety net for the download → fix →
 * upload loop. Stored as zips under `snapshots/{host}/` in the existing
 * studio-sites bucket (deliberately NO new table or migration: the storage
 * listing IS the history), newest kept to SNAPSHOT_KEEP per site.
 */

export const SNAPSHOT_KEEP = 5;

export interface SiteSnapshot {
  /** Full storage path, e.g. snapshots/foo.dmviral.com/2026-08-14T18-00-00-000Z.zip */
  path: string;
  name: string;
  takenAt: string | null;
  bytes: number | null;
}

export function snapshotPrefix(host: string): string {
  return `snapshots/${host}`;
}

/** Storage keys keep ISO ordering but drop the characters object keys dislike. */
export function snapshotName(nowIso: string): string {
  return `${nowIso.replace(/[:.]/g, "-")}.zip`;
}

/** Newest-first snapshot listing for a site. Null when the site is unparseable
 *  or the listing itself fails (never [] for those). */
export async function listSiteSnapshots(admin: SupabaseClient, rawSite: string): Promise<SiteSnapshot[] | null> {
  const host = siteHostFrom(rawSite);
  if (!host) return null;
  const { data, error } = await admin.storage
    .from(SITES_BUCKET)
    .list(snapshotPrefix(host), { limit: 100, sortBy: { column: "name", order: "desc" } });
  if (error) return null;
  return (data ?? [])
    .filter((f) => f.name.endsWith(".zip"))
    .map((f) => ({
      path: `${snapshotPrefix(host)}/${f.name}`,
      name: f.name,
      takenAt: (f as { created_at?: string }).created_at ?? null,
      bytes: ((f as { metadata?: { size?: number } }).metadata?.size as number | undefined) ?? null,
    }));
}

/**
 * Zip the site's CURRENT live files into a new snapshot, then prune beyond
 * SNAPSHOT_KEEP (prune is best-effort — a failed delete never fails the
 * snapshot). Callers decide whether a failure blocks their write; the
 * override route proceeds with a warning, since refusing would make urgent
 * fixes less shippable than before snapshots existed.
 */
export async function snapshotSite(
  admin: SupabaseClient,
  rawSite: string,
  nowIso: string,
): Promise<{ ok: true; path: string; bytes: number } | { ok: false; message: string }> {
  const current = await fetchLiveSiteZip(rawSite);
  if (!current.ok) return { ok: false, message: current.error };

  const path = `${snapshotPrefix(current.host)}/${snapshotName(nowIso)}`;
  const { error } = await admin.storage.from(SITES_BUCKET).upload(path, current.zip, {
    contentType: "application/zip",
    upsert: true,
  });
  if (error) return { ok: false, message: error.message };

  const all = await listSiteSnapshots(admin, current.host);
  if (all && all.length > SNAPSHOT_KEEP) {
    const doomed = all
      .filter((s) => s.path !== path)
      .sort((a, b) => (a.name < b.name ? 1 : -1)) // newest first by sortable name
      .slice(SNAPSHOT_KEEP - 1)
      .map((s) => s.path);
    if (doomed.length) await admin.storage.from(SITES_BUCKET).remove(doomed).catch(() => undefined);
  }

  return { ok: true, path, bytes: current.zip.length };
}

/** A stored snapshot's zip bytes — path must belong to this site's prefix
 *  (the caller passes user input; never let it read arbitrary storage). */
export async function readSiteSnapshot(
  admin: SupabaseClient,
  rawSite: string,
  path: string,
): Promise<{ ok: true; zip: Uint8Array } | { ok: false; message: string }> {
  const host = siteHostFrom(rawSite);
  if (!host) return { ok: false, message: "invalid site" };
  if (!path.startsWith(`${snapshotPrefix(host)}/`) || path.includes("..")) {
    return { ok: false, message: "that snapshot does not belong to this site" };
  }
  const { data, error } = await admin.storage.from(SITES_BUCKET).download(path);
  if (error || !data) return { ok: false, message: error?.message ?? "snapshot not found" };
  return { ok: true, zip: new Uint8Array(await data.arrayBuffer()) };
}
