"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { useViewScope } from "@/providers/ViewScopeProvider";
import { LeadsSync, createSyncScheduler, permissionFingerprint, type LiveSnapshot } from "@/lib/leads/liveSync";
import { supabaseLeadsSource, idbLeadsCache, LEADS_CACHE_PREFIX } from "@/lib/leads/liveSource";
import { subscribeLeadsTicks } from "@/lib/realtime/leadsTicks";

/**
 * The person's leads, live. One copy per browser tab, shared by every screen
 * (Leads, HitList, Follow-ups, Dashboard), kept across navigation and — in
 * IndexedDB — across reloads. It follows changes on its own:
 *  - a database tick → read only what changed (lib/leads/liveSync.ts);
 *  - the tab is looked at again, or the window gets focus → catch up;
 *  - the realtime socket reconnects → catch up;
 *  - and, as a floor in case a tick is ever lost, a cheap check every minute
 *    while the tab is visible.
 */

/** Visible-tab safety check. A sync with nothing new is two tiny reads. */
export const LIVE_LEADS_POLL_MS = 60_000;
/** On focus / visible, sync if the last one is older than this. */
export const LIVE_LEADS_STALE_MS = 10_000;

type Live = { engine: LeadsSync; teardown: () => void };
let live: Live | null = null;
let liveKey = "";

function isVisible() {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

function wire(engine: LeadsSync): () => void {
  const scheduler = createSyncScheduler((o) => void engine.sync(o), isVisible);
  const unsubscribe = subscribeLeadsTicks(
    (kind) => scheduler.onTick(kind),
    () => void engine.sync({ tags: true }),
  );
  const catchUp = () => {
    if (!isVisible()) return;
    if (scheduler.pending) scheduler.onVisible();
    else if (Date.now() - engine.lastSyncAt > LIVE_LEADS_STALE_MS) void engine.sync();
  };
  document.addEventListener("visibilitychange", catchUp);
  window.addEventListener("focus", catchUp);
  window.addEventListener("online", catchUp);
  const poll = setInterval(() => {
    if (isVisible()) void engine.sync();
  }, LIVE_LEADS_POLL_MS);
  return () => {
    unsubscribe();
    scheduler.dispose();
    clearInterval(poll);
    document.removeEventListener("visibilitychange", catchUp);
    window.removeEventListener("focus", catchUp);
    window.removeEventListener("online", catchUp);
  };
}

/** The tab's live engine for this person and permission set (created on first use). */
export function liveLeadsEngine(userId: string, fingerprint: string): LeadsSync {
  const key = `${userId}|${fingerprint}`;
  if (live && liveKey === key) return live.engine;
  if (live) {
    live.teardown();
    live.engine.dispose();
  }
  const engine = new LeadsSync(supabaseLeadsSource(), idbLeadsCache, `${LEADS_CACHE_PREFIX}${userId}`, fingerprint);
  const teardown = typeof window === "undefined" ? () => {} : wire(engine);
  live = { engine, teardown };
  liveKey = key;
  return engine;
}

/** Signed out: stop this tab's engine and forget its in-memory copy. */
export function resetLiveLeads(): void {
  if (!live) return;
  live.teardown();
  live.engine.dispose();
  live = null;
  liveKey = "";
}

/**
 * After this tab saved a lead change: sync now rather than waiting for the
 * database's tick to come back round (it will too — this is just sooner).
 */
export function syncLeadsNow(opts: { tags?: boolean } = {}): void {
  void live?.engine.sync(opts);
}

const SERVER_SNAPSHOT: LiveSnapshot = { status: "idle", leads: [], error: null, fromCache: false };

export function useLiveLeads(): LiveSnapshot & { retry: () => void } {
  const userId = useViewScope();
  const { all } = usePermissions();
  const fingerprint = useMemo(() => permissionFingerprint(all), [all]);
  const engine = useMemo(
    () => (typeof window === "undefined" ? null : liveLeadsEngine(userId, fingerprint)),
    [userId, fingerprint],
  );
  useEffect(() => {
    void engine?.start();
  }, [engine]);
  const subscribe = useCallback((fn: () => void) => (engine ? engine.subscribe(fn) : () => {}), [engine]);
  const snap = useSyncExternalStore(
    subscribe,
    () => (engine ? engine.getSnapshot() : SERVER_SNAPSHOT),
    () => SERVER_SNAPSHOT,
  );
  const retry = useCallback(() => void engine?.sync(), [engine]);
  return { ...snap, retry };
}
