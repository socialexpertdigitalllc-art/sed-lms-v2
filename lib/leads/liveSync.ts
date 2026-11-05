import type { Lead } from "@/lib/leads/types";

/**
 * The live leads store — load the leads once, then keep them current with only
 * what changed. (Option A of the 2026-11 data strategy; see
 * docs/sops/live-leads.md.)
 *
 * Before this, every lead change made every open Leads / Follow-ups tab ask the
 * server to rebuild the whole page, and the server re-read every lead the
 * person can see (~1,000 rows, ~1.6 MB) each time — and again on each
 * navigation and reload. Now:
 *
 *  1. The first time, the browser reads the person's leads once, straight from
 *     Supabase under their own row-level security, and keeps the copy (in
 *     IndexedDB, so a reload opens instantly from it).
 *  2. A change to `leads` (or a lead's tags) makes the database broadcast a
 *     tiny "something changed" tick — no data in it.
 *  3. On a tick each open screen asks for ONLY the rows changed since its last
 *     sync (an indexed `updated_at > cursor` read — usually one row) and
 *     patches them in place.
 *  4. A cheap count check catches what a "changed since" read cannot: a lead
 *     that LEFT the person's view (reassigned away, moved to a status they
 *     can't see, hard-deleted). On a mismatch the ids are reconciled.
 *
 * This module is the engine only — no React, no Supabase, no timers of its
 * own beyond the debounced cache save — so it is fully testable with fakes.
 */

/** A lead row as the store keeps it. `deleted_at` set = soft-deleted. */
export type SyncRow = Lead & { deleted_at?: string | null };

export type TagLink = { lead_id: string; tag_id: string };

/** Where the rows come from (the browser Supabase client in the app). Every
 *  read runs under the viewer's own row-level security. */
export interface LeadsSource {
  /** Visible, not-deleted leads, one inclusive page, newest first (created_at desc, id). */
  page(from: number, to: number): Promise<SyncRow[]>;
  /** Visible rows changed after `sinceIso`, deleted ones INCLUDED, one page ordered by updated_at, id. */
  changedSince(sinceIso: string, from: number, to: number): Promise<SyncRow[]>;
  /** How many visible, not-deleted leads there are right now. */
  count(): Promise<number>;
  /** Visible, not-deleted lead ids, one page ordered by id. */
  ids(from: number, to: number): Promise<string[]>;
  /** These visible leads, in full. */
  byIds(ids: string[]): Promise<SyncRow[]>;
  /** Every tag link the viewer can see, one page. */
  tagLinks(from: number, to: number): Promise<TagLink[]>;
}

export interface CachedLeads {
  v: number;
  fingerprint: string;
  cursor: string | null;
  savedAt: number;
  rows: SyncRow[];
}

/** The browser copy between visits (IndexedDB in the app). */
export interface LeadsCache {
  load(key: string): Promise<CachedLeads | null>;
  save(key: string, value: CachedLeads): Promise<void>;
}

export type LiveStatus = "idle" | "loading" | "ready" | "error";

export interface LiveSnapshot {
  status: LiveStatus;
  /** Newest first: created_at desc, then id — the order the pages always used. */
  leads: Lead[];
  /** The last sync's error. Kept alongside data when a background sync fails. */
  error: string | null;
  /** True while showing the saved copy before the first sync has confirmed it. */
  fromCache: boolean;
}

/** Rows per request — PostgREST's own cap. A short page is the stop signal. */
export const PAGE_SIZE = 1000;
/** Re-read this far behind the cursor, so a transaction that started before the
 *  last sync but committed after it (its updated_at is its start time) is
 *  never missed. Re-reading a few recent rows is harmless: merges are idempotent. */
export const OVERLAP_MS = 2 * 60_000;
/** A saved copy older than this is dropped and the leads read afresh. */
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
/** Bump when the saved row shape changes. */
export const CACHE_VERSION = 1;
/** Rows fetched per `in (...)` request during a reconcile. */
export const BY_IDS_CHUNK = 100;

export type SyncOptions = {
  now?: () => number;
  saveDelayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
};

function sameTags(a: string[] | undefined, b: string[] | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

function byNewest(a: Lead, b: Lead): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function allPages<T>(page: (from: number, to: number) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const rows = await page(from, from + PAGE_SIZE - 1);
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;
  }
}

export class LeadsSync {
  private rows = new Map<string, SyncRow>();
  /** Newest updated_at seen, in ms. Null until the first full read. */
  private cursor: number | null = null;
  private snapshot: LiveSnapshot = { status: "idle", leads: [], error: null, fromCache: false };
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private againTags = false;
  private started: Promise<void> | null = null;
  private saveTimer: unknown = null;
  private disposed = false;
  private readonly now: () => number;
  private readonly saveDelayMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (t: unknown) => void;
  /** When the last sync finished (ms) — for "sync again on focus if stale". */
  lastSyncAt = 0;

  constructor(
    private readonly src: LeadsSource,
    private readonly cache: LeadsCache | null,
    private readonly key: string,
    private readonly fingerprint: string,
    opts: SyncOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.saveDelayMs = opts.saveDelayMs ?? 1500;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  }

  getSnapshot = (): LiveSnapshot => this.snapshot;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  /** Open from the saved copy when it fits, then sync; otherwise read everything. Idempotent. */
  start(): Promise<void> {
    if (!this.started) this.started = this.boot();
    return this.started;
  }

  private async boot(): Promise<void> {
    let cached: CachedLeads | null = null;
    try {
      cached = (await this.cache?.load(this.key)) ?? null;
    } catch {
      cached = null;
    }
    const fits =
      cached &&
      cached.v === CACHE_VERSION &&
      cached.fingerprint === this.fingerprint &&
      this.now() - cached.savedAt < CACHE_MAX_AGE_MS &&
      Array.isArray(cached.rows);
    if (fits && cached) {
      for (const r of cached.rows) if (r && r.id && !r.deleted_at) this.rows.set(r.id, r);
      const c = cached.cursor ? Date.parse(cached.cursor) : NaN;
      this.cursor = Number.isNaN(c) ? null : c;
      this.publish({ status: "ready", fromCache: true, error: null });
    } else {
      this.publish({ status: "loading" });
    }
    await this.sync();
  }

  /**
   * Bring the copy up to date. Calls made while one is running are folded
   * into ONE more run after it (a burst of ticks costs two syncs, not N).
   * `tags` also re-reads the tag links (a tag was added to / removed from a lead).
   */
  sync(opts: { tags?: boolean } = {}): Promise<void> {
    if (opts.tags) this.againTags = true;
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          const tags = this.againTags;
          this.againTags = false;
          await this.syncOnce(tags);
        } while (this.again && !this.disposed);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async syncOnce(tags: boolean): Promise<void> {
    if (this.disposed) return;
    try {
      if (this.cursor === null) {
        await this.fullLoad();
      } else {
        let changed = await this.delta(this.cursor);
        const serverCount = await this.src.count();
        if (serverCount !== this.rows.size) changed = (await this.reconcile()) || changed;
        if (tags) changed = (await this.refreshTags()) || changed;
        this.publish({ status: "ready", fromCache: false, error: null }, changed);
        if (changed) this.scheduleSave();
      }
      this.lastSyncAt = this.now();
    } catch (e) {
      const hasData = this.snapshot.status === "ready";
      this.publish(hasData ? { error: errMsg(e) } : { status: "error", error: errMsg(e) });
    }
  }

  private async fullLoad(): Promise<void> {
    const rows = await allPages((f, t) => this.src.page(f, t));
    this.rows.clear();
    let max = 0;
    for (const r of rows) {
      if (r.deleted_at) continue;
      this.rows.set(r.id, r);
      const t = Date.parse(r.updated_at ?? r.created_at);
      if (!Number.isNaN(t) && t > max) max = t;
    }
    // An empty list still needs a cursor, or every sync would re-read everything.
    this.cursor = max || this.now();
    this.publish({ status: "ready", fromCache: false, error: null }, true);
    this.scheduleSave();
  }

  private async delta(cursor: number): Promise<boolean> {
    const since = new Date(cursor - OVERLAP_MS).toISOString();
    const rows = await allPages((f, t) => this.src.changedSince(since, f, t));
    return this.apply(rows);
  }

  /** Merge rows; true when anything on screen would change. */
  private apply(rows: SyncRow[]): boolean {
    let changed = false;
    for (const r of rows) {
      const t = Date.parse(r.updated_at ?? "");
      if (!Number.isNaN(t) && (this.cursor === null || t > this.cursor)) this.cursor = t;
      if (r.deleted_at) {
        if (this.rows.delete(r.id)) changed = true;
        continue;
      }
      const prev = this.rows.get(r.id);
      if (prev && prev.updated_at === r.updated_at && sameTags(prev.tag_ids, r.tag_ids)) continue;
      this.rows.set(r.id, r);
      changed = true;
    }
    return changed;
  }

  /** The count disagreed: drop what the viewer can no longer see, fetch what they newly can. */
  private async reconcile(): Promise<boolean> {
    const ids = new Set(await allPages((f, t) => this.src.ids(f, t)));
    let changed = false;
    for (const id of [...this.rows.keys()]) {
      if (!ids.has(id)) {
        this.rows.delete(id);
        changed = true;
      }
    }
    const missing = [...ids].filter((id) => !this.rows.has(id));
    for (let i = 0; i < missing.length; i += BY_IDS_CHUNK) {
      const got = await this.src.byIds(missing.slice(i, i + BY_IDS_CHUNK));
      changed = this.apply(got) || changed;
    }
    return changed;
  }

  /** A tag was added or removed somewhere: re-read the (small) tag link list. */
  private async refreshTags(): Promise<boolean> {
    const links = await allPages((f, t) => this.src.tagLinks(f, t));
    const byLead = new Map<string, string[]>();
    for (const l of links) {
      const list = byLead.get(l.lead_id);
      if (list) list.push(l.tag_id);
      else byLead.set(l.lead_id, [l.tag_id]);
    }
    let changed = false;
    for (const [id, row] of this.rows) {
      const next = (byLead.get(id) ?? []).sort();
      if (sameTags([...(row.tag_ids ?? [])].sort(), next)) continue;
      this.rows.set(id, { ...row, tag_ids: next });
      changed = true;
    }
    return changed;
  }

  private publish(patch: Partial<Omit<LiveSnapshot, "leads">>, rowsChanged = false): void {
    if (this.disposed) return;
    const leads = rowsChanged || this.snapshot.status !== "ready" ? [...this.rows.values()].sort(byNewest) : this.snapshot.leads;
    const next: LiveSnapshot = { ...this.snapshot, ...patch, leads };
    const same =
      next.status === this.snapshot.status &&
      next.error === this.snapshot.error &&
      next.fromCache === this.snapshot.fromCache &&
      next.leads === this.snapshot.leads;
    if (same) return;
    this.snapshot = next;
    for (const fn of this.listeners) fn();
  }

  private scheduleSave(): void {
    if (!this.cache || this.disposed) return;
    if (this.saveTimer) this.clearTimer(this.saveTimer);
    this.saveTimer = this.setTimer(() => {
      this.saveTimer = null;
      void this.saveNow();
    }, this.saveDelayMs);
  }

  /** Write the copy now (also used by tests). Never throws. */
  async saveNow(): Promise<void> {
    if (!this.cache || this.disposed) return;
    try {
      await this.cache.save(this.key, {
        v: CACHE_VERSION,
        fingerprint: this.fingerprint,
        cursor: this.cursor === null ? null : new Date(this.cursor).toISOString(),
        savedAt: this.now(),
        rows: [...this.rows.values()],
      });
    } catch {
      /* a full disk or private mode — the live copy still works */
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.saveTimer) this.clearTimer(this.saveTimer);
    this.saveTimer = null;
    this.listeners.clear();
  }
}

/** Identifies "same person, same permissions" for the saved copy. A
 *  permission change throws the copy away and reads afresh. */
export function permissionFingerprint(perms: Iterable<string>): string {
  const keys = [...perms].sort().join(",");
  let h = 5381;
  for (let i = 0; i < keys.length; i++) h = ((h << 5) + h + keys.charCodeAt(i)) | 0;
  return `p${(h >>> 0).toString(36)}:${keys.length}`;
}

/**
 * When to sync on a tick: wait a moment so a burst (a bulk change) is one
 * sync, spread tabs out a little, and do nothing in a hidden tab — it syncs
 * once when it is looked at again. Pure timing; injectable for tests.
 */
export function createSyncScheduler(
  run: (opts: { tags: boolean }) => void,
  isVisible: () => boolean,
  opts: {
    debounceMs?: number;
    jitterMs?: number;
    random?: () => number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (t: unknown) => void;
  } = {},
) {
  const debounceMs = opts.debounceMs ?? 250;
  const jitterMs = opts.jitterMs ?? 400;
  const random = opts.random ?? Math.random;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  let pending = false;
  let pendingTags = false;

  const fire = () => {
    timer = null;
    if (!isVisible()) return; // stays pending; resumed by onVisible()
    const tags = pendingTags;
    pending = false;
    pendingTags = false;
    run({ tags });
  };

  return {
    /** A change was announced. */
    onTick(kind: "leads" | "tags") {
      pending = true;
      if (kind === "tags") pendingTags = true;
      if (!isVisible() || timer) return;
      timer = setTimer(fire, debounceMs + random() * jitterMs);
    },
    /** The tab became visible: catch up on anything announced while hidden. */
    onVisible() {
      if (pending && !timer) timer = setTimer(fire, 0);
    },
    get pending() {
      return pending;
    },
    dispose() {
      if (timer) clearTimer(timer);
      timer = null;
    },
  };
}
