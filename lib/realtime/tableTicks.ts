"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { subscribeLeadsTicks } from "./leadsTicks";

/**
 * "This table changed" ticks for every table a screen shows (migration 0099).
 * Each table has its own public Realtime topic, `lms:t:<table>`, so a screen
 * listens only to what it shows. The leads group (leads, tags, follow-ups,
 * tickets) arrives on the shared `lms:leads` topic (lib/realtime/leadsTicks.ts)
 * and is passed through here under the same API.
 *
 * A tick carries no data beyond which row changed: `id`, and the row's
 * `lead_id` / `ticket_id` when it has them — so an open lead or ticket page
 * can ignore everyone else's rows. Screens then re-read what they show under
 * their own row-level security.
 */

export type TablePayload = { table: string; op?: string; id?: string; lead_id?: string; ticket_id?: string };
type Listener = (p: TablePayload) => void;

export const LEADS_GROUP_TABLES = new Set(["leads", "lead_tag_links", "lead_follow_ups", "lead_tickets"]);
export const TABLE_TICK_EVENT = "changed";
export const tableTopic = (table: string) => `lms:t:${table}`;

type Topic = { channel: RealtimeChannel; listeners: Set<Listener>; reconnect: Set<() => void>; subscribedOnce: boolean };
const topics = new Map<string, Topic>();
let client: ReturnType<typeof createClient> | null = null;

/** Turn a broadcast body into a payload (unknown fields dropped, ids as strings). */
export function toTablePayload(table: string, body: unknown): TablePayload {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return { table, op: str(b.op), id: str(b.id), lead_id: str(b.lead_id), ticket_id: str(b.ticket_id) };
}

function openTopic(table: string): Topic | null {
  const name = tableTopic(table);
  const existing = topics.get(name);
  if (existing) return existing;
  try {
    client ??= createClient();
  } catch {
    return null; // Supabase not configured here (tests, previews): no live ticks, nothing breaks
  }
  const t: Topic = { channel: client.channel(name), listeners: new Set(), reconnect: new Set(), subscribedOnce: false };
  t.channel
    .on("broadcast", { event: TABLE_TICK_EVENT }, (msg) => {
      const p = toTablePayload(table, (msg as { payload?: unknown }).payload);
      for (const fn of t.listeners) fn(p);
    })
    .subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      if (t.subscribedOnce) for (const fn of t.reconnect) fn();
      t.subscribedOnce = true;
    });
  topics.set(name, t);
  return t;
}

function closeTopic(table: string) {
  const name = tableTopic(table);
  const t = topics.get(name);
  if (!t || t.listeners.size || t.reconnect.size) return;
  client?.removeChannel(t.channel);
  topics.delete(name);
}

/** Listen for changes to any of these tables. `onReconnect`: the socket came back (changes may have been missed). */
export function subscribeTableTicks(tables: string[], fn: Listener, onReconnect?: () => void): () => void {
  if (typeof window === "undefined" || !tables.length) return () => {};
  const unsubs: (() => void)[] = [];
  const own = tables.filter((t) => !LEADS_GROUP_TABLES.has(t));
  const group = tables.filter((t) => LEADS_GROUP_TABLES.has(t));
  for (const table of own) {
    const t = openTopic(table);
    if (!t) continue;
    t.listeners.add(fn);
    if (onReconnect) t.reconnect.add(onReconnect);
    unsubs.push(() => {
      t.listeners.delete(fn);
      if (onReconnect) t.reconnect.delete(onReconnect);
      closeTopic(table);
    });
  }
  if (group.length) {
    unsubs.push(
      subscribeLeadsTicks((_kind, table, body) => {
        if (group.includes(table)) fn(toTablePayload(table, body));
      }, onReconnect),
    );
  }
  return () => unsubs.forEach((u) => u());
}

/**
 * When a tick turns into work (a page refresh, a re-read): wait a moment so a
 * burst is one run, spread tabs out a little, never more often than `minGapMs`,
 * and nothing in a hidden tab — it runs once when looked at again.
 */
export function createTickPacer(
  run: () => void,
  opts: {
    debounceMs?: number;
    jitterMs?: number;
    minGapMs?: number;
    isVisible?: () => boolean;
    now?: () => number;
    random?: () => number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (t: unknown) => void;
  } = {},
) {
  const debounceMs = opts.debounceMs ?? 300;
  const jitterMs = opts.jitterMs ?? 400;
  const minGapMs = opts.minGapMs ?? 3000;
  const isVisible = opts.isVisible ?? (() => typeof document === "undefined" || document.visibilityState === "visible");
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  let pending = false;
  let last = -Infinity;

  const schedule = (base: number) => {
    if (timer) return;
    const wait = Math.max(base, last + minGapMs - now());
    timer = setTimer(() => {
      timer = null;
      if (!isVisible()) return; // stays pending
      pending = false;
      last = now();
      run();
    }, wait);
  };
  return {
    tick() {
      pending = true;
      if (isVisible()) schedule(debounceMs + random() * jitterMs);
    },
    visible() {
      if (pending) schedule(0);
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
