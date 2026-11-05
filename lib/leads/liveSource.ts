"use client";

import { createClient } from "@/lib/supabase/client";
import type { CachedRows, LeadsSource, LiveCache, LiveRow, SyncRow, TagLink } from "./liveSync";

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
/** Every saved leads copy is keyed `leads:<user id>`, follow-ups `followups:<user id>`. */
export const LEADS_CACHE_PREFIX = "leads:";
export const FOLLOWUPS_CACHE_PREFIX = "followups:";
const CACHE_PREFIXES = [LEADS_CACHE_PREFIX, FOLLOWUPS_CACHE_PREFIX];

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
export function idbLiveCache<R extends LiveRow>(): LiveCache<R> {
  return {
  async load(key) {
    const db = await openDb();
    if (!db) return null;
    try {
      return await new Promise<CachedRows<R> | null>((resolve) => {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
        req.onsuccess = () => resolve((req.result as CachedRows<R> | undefined) ?? null);
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
}

export const idbLeadsCache: LiveCache<SyncRow> = idbLiveCache<SyncRow>();

/** Forget every saved copy (leads, follow-ups) on this browser (sign-in page). */
export async function clearLeadsCache(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.getAllKeys();
    req.onsuccess = () => {
      for (const k of req.result) if (CACHE_PREFIXES.some((p) => String(k).startsWith(p))) store.delete(k);
    };
    await done(tx);
  } catch {
    /* best effort */
  } finally {
    db.close();
  }
}

// ── Follow-ups (append-only: a follow-up is logged, never edited) ───────────

/** The columns the Dashboard's follow-up numbers read. */
export type FollowUpLive = { id: string; created_at: string; fu_status: string; lead_id: string | null };
const FU_SELECT = "id, created_at, fu_status, lead_id";

export function supabaseFollowUpsSource(client = createClient()): import("./liveSync").LiveSource<FollowUpLive> {
  return {
    async page(from, to) {
      const res = await client
        .from("lead_follow_ups")
        .select(FU_SELECT)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to);
      return check<FollowUpLive[]>(res);
    },
    async changedSince(sinceIso, from, to) {
      const res = await client
        .from("lead_follow_ups")
        .select(FU_SELECT)
        .gt("created_at", sinceIso)
        .order("created_at")
        .order("id")
        .range(from, to);
      return check<FollowUpLive[]>(res);
    },
    async count() {
      const res = await client.from("lead_follow_ups").select("id", { count: "exact", head: true });
      if (res.error) throw new Error(res.error.message);
      return res.count ?? 0;
    },
    async ids(from, to) {
      const res = await client.from("lead_follow_ups").select("id").order("id").range(from, to);
      return check<{ id: string }[]>(res).map((r) => r.id);
    },
    async byIds(ids) {
      if (!ids.length) return [];
      const res = await client.from("lead_follow_ups").select(FU_SELECT).in("id", ids);
      return check<FollowUpLive[]>(res);
    },
  };
}
