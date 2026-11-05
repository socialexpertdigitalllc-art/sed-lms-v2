"use client";

import { createClient } from "@/lib/supabase/client";
import type { CachedLeads, LeadsCache, LeadsSource, SyncRow, TagLink } from "./liveSync";

/**
 * The live leads store's reads, straight from the browser to Supabase with the
 * signed-in person's own session — so row-level security decides what they
 * get, exactly as it did for the server-rendered pages, and none of it passes
 * through (or loads) the app server. See lib/leads/liveSync.ts.
 */

const SELECT = "*, lead_tag_links(tag_id)";

type RawRow = Record<string, unknown> & { lead_tag_links?: { tag_id: string }[] | null };

/** Flatten the embedded tag links into a sorted `tag_ids` (as the pages did). */
export function toSyncRow(row: RawRow): SyncRow {
  const { lead_tag_links, ...rest } = row;
  const tag_ids = (lead_tag_links ?? []).map((l) => l.tag_id).sort();
  return { ...(rest as unknown as SyncRow), tag_ids };
}

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? ([] as unknown)) as T;
}

export function supabaseLeadsSource(client = createClient()): LeadsSource {
  return {
    async page(from, to) {
      const res = await client
        .from("leads")
        .select(SELECT)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to);
      return check<RawRow[]>(res).map(toSyncRow);
    },
    async changedSince(sinceIso, from, to) {
      // Deleted rows included on purpose: that is how a delete reaches the copy.
      const res = await client
        .from("leads")
        .select(SELECT)
        .gt("updated_at", sinceIso)
        .order("updated_at")
        .order("id")
        .range(from, to);
      return check<RawRow[]>(res).map(toSyncRow);
    },
    async count() {
      const res = await client.from("leads").select("id", { count: "exact", head: true }).is("deleted_at", null);
      if (res.error) throw new Error(res.error.message);
      return res.count ?? 0;
    },
    async ids(from, to) {
      const res = await client.from("leads").select("id").is("deleted_at", null).order("id").range(from, to);
      return check<{ id: string }[]>(res).map((r) => r.id);
    },
    async byIds(ids) {
      if (!ids.length) return [];
      const res = await client.from("leads").select(SELECT).in("id", ids);
      return check<RawRow[]>(res).map(toSyncRow);
    },
    async tagLinks(from, to) {
      const res = await client
        .from("lead_tag_links")
        .select("lead_id, tag_id")
        .order("lead_id")
        .order("tag_id")
        .range(from, to);
      return check<TagLink[]>(res);
    },
  };
}

// ── The browser copy (IndexedDB) ─────────────────────────────────────────────

const DB_NAME = "sed-lms";
const STORE = "kv";
/** Every saved leads copy is keyed `leads:<user id>`. */
export const LEADS_CACHE_PREFIX = "leads:";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** IndexedDB-backed copy. Every failure (private mode, quota, blocked) reads as "no copy". */
export const idbLeadsCache: LeadsCache = {
  async load(key) {
    const db = await openDb();
    if (!db) return null;
    try {
      return await new Promise<CachedLeads | null>((resolve) => {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
        req.onsuccess = () => resolve((req.result as CachedLeads | undefined) ?? null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    } finally {
      db.close();
    }
  },
  async save(key, value) {
    const db = await openDb();
    if (!db) return;
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      await done(tx);
    } finally {
      db.close();
    }
  },
};

/** Forget every saved leads copy on this browser (sign-in page, sign-out). */
export async function clearLeadsCache(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.getAllKeys();
    req.onsuccess = () => {
      for (const k of req.result) if (String(k).startsWith(LEADS_CACHE_PREFIX)) store.delete(k);
    };
    await done(tx);
  } catch {
    /* best effort */
  } finally {
    db.close();
  }
}
