"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/**
 * "Something changed" ticks for leads, broadcast by the database itself
 * (migration 0097: a statement-level trigger on `leads` and `lead_tag_links`
 * calls realtime.send). The tick carries NO lead data — only which table
 * changed — so the channel can be public; each screen then reads the changed
 * rows itself, under its own row-level security.
 *
 * One channel per browser tab, shared by every listener (the live leads store,
 * the sidebar badges, an open lead page), opened on the first listener and
 * closed with the last.
 *
 * Why not postgres_changes on `leads` as before: that makes the database run
 * the row-level security check once per listening tab for every change, and
 * ships the whole row to each — the per-subscriber cost Supabase warns grows
 * with every user added. A broadcast tick costs the same for 1 tab or 500.
 */

export const LEADS_TICK_TOPIC = "lms:leads";
export const LEADS_TICK_EVENT = "changed";

/** "leads" / "tags" for the leads store; "other" for any other table that ticks
 *  (lead_follow_ups, lead_tickets — migration 0098), whose own stores look at
 *  the table name. */
export type TickKind = "leads" | "tags" | "other";
type TickListener = (kind: TickKind, table: string, payload: Record<string, unknown>) => void;

const listeners = new Set<TickListener>();
const reconnectListeners = new Set<() => void>();
let channel: RealtimeChannel | null = null;
let client: ReturnType<typeof createClient> | null = null;
let subscribedOnce = false;

/** Which table a broadcast payload announces (an unlabelled tick counts as leads). */
export function tickTable(payload: unknown): string {
  const table = (payload as { table?: unknown } | null)?.table;
  return typeof table === "string" && table ? table : "leads";
}

/** Which kind of change a broadcast payload announces. */
export function tickKind(payload: unknown): TickKind {
  const table = tickTable(payload);
  return table === "lead_tag_links" ? "tags" : table === "leads" ? "leads" : "other";
}

function open() {
  if (channel || typeof window === "undefined") return;
  try {
    client = createClient();
  } catch {
    return; // Supabase not configured here (tests, previews): no live ticks, nothing breaks
  }
  channel = client.channel(LEADS_TICK_TOPIC);
  channel
    .on("broadcast", { event: LEADS_TICK_EVENT }, (msg) => {
      const payload = (msg as { payload?: unknown }).payload;
      const kind = tickKind(payload);
      const table = tickTable(payload);
      const body = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
      for (const fn of listeners) fn(kind, table, body);
    })
    .subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      // Every (re)connection after the first may have missed ticks.
      if (subscribedOnce) for (const fn of reconnectListeners) fn();
      subscribedOnce = true;
    });
}

function closeIfIdle() {
  if (listeners.size || reconnectListeners.size || !channel) return;
  client?.removeChannel(channel);
  channel = null;
  subscribedOnce = false;
}

/** Listen for lead change ticks; `onReconnect` fires when the socket comes back. */
export function subscribeLeadsTicks(fn: TickListener, onReconnect?: () => void): () => void {
  listeners.add(fn);
  if (onReconnect) reconnectListeners.add(onReconnect);
  open();
  return () => {
    listeners.delete(fn);
    if (onReconnect) reconnectListeners.delete(onReconnect);
    closeIfIdle();
  };
}
