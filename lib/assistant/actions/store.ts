import type { SupabaseClient } from "@supabase/supabase-js";
import { canUndo, type ActionCard } from "./card";
import type { StoredAction } from "./types";

/**
 * Persistence for SED AI actions: proposals, their outcomes, and the admin
 * switches. SERVER ONLY — service-role client, with every owner check made
 * here (or by the caller, for approvers) rather than trusted to the client.
 */

type Admin = SupabaseClient;

const COLUMNS =
  "id, user_id, conversation_id, turn_id, tool_call_id, plan_id, plan_index, plan_title, action_key, title, risk, input, card, before_state, confirm_phrase, status, result, error, source, approver_id, approval_note, decided_at, reported_at, undo_until, created_at, updated_at, executed_at, expires_at";

export type NewAction = Omit<
  StoredAction,
  "id" | "created_at" | "updated_at" | "executed_at" | "reported_at" | "decided_at" | "approver_id" | "approval_note" | "result" | "error" | "undo_until" | "expires_at"
> & { expires_at?: string };

export async function insertAction(admin: Admin, row: NewAction): Promise<StoredAction> {
  const { data, error } = await admin.from("assistant_actions").insert(row).select(COLUMNS).single();
  if (error || !data) throw new Error(error?.message ?? "Could not save the action");
  return data as StoredAction;
}

export async function getAction(admin: Admin, id: string): Promise<StoredAction | null> {
  const { data, error } = await admin.from("assistant_actions").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as StoredAction | null) ?? null;
}

/** Only the owner's own action: anyone else's id reads as not found. */
export async function getOwnAction(admin: Admin, userId: string, id: string): Promise<StoredAction | null> {
  const row = await getAction(admin, id);
  return row && row.user_id === userId ? row : null;
}

/** A chat's latest actions (up to `limit`), oldest first. */
export async function listConversationActions(admin: Admin, userId: string, conversationId: string, limit = 500): Promise<StoredAction[]> {
  const { data, error } = await admin
    .from("assistant_actions")
    .select(COLUMNS)
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as StoredAction[]).reverse();
}

export async function listPlan(admin: Admin, planId: string): Promise<StoredAction[]> {
  const { data, error } = await admin.from("assistant_actions").select(COLUMNS).eq("plan_id", planId).order("plan_index", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as StoredAction[];
}

/**
 * Move an action from one status to another ONLY if it is still in the
 * expected one — two Confirm clicks (two tabs, a double tap) run it once.
 */
export async function transition(
  admin: Admin,
  id: string,
  from: StoredAction["status"] | StoredAction["status"][],
  patch: Partial<StoredAction>,
): Promise<StoredAction | null> {
  const froms = Array.isArray(from) ? from : [from];
  const { data, error } = await admin
    .from("assistant_actions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", froms)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as StoredAction | null) ?? null;
}

export async function updateAction(admin: Admin, id: string, patch: Partial<StoredAction>): Promise<StoredAction | null> {
  const { data, error } = await admin
    .from("assistant_actions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as StoredAction | null) ?? null;
}

export interface HistoryQuery {
  /** Only this person's actions; omit for everyone (approvers, the report). */
  userId?: string;
  statuses?: StoredAction["status"][];
  since?: string;
  until?: string;
  limit?: number;
  /** Older than this created_at (paging). */
  before?: string;
}

export async function listActions(admin: Admin, q: HistoryQuery): Promise<StoredAction[]> {
  let query = admin.from("assistant_actions").select(COLUMNS).order("created_at", { ascending: false }).limit(Math.min(q.limit ?? 50, 1000));
  if (q.userId) query = query.eq("user_id", q.userId);
  if (q.statuses?.length) query = query.in("status", q.statuses);
  if (q.since) query = query.gte("created_at", q.since);
  if (q.until) query = query.lt("created_at", q.until);
  if (q.before) query = query.lt("created_at", q.before);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as StoredAction[];
}

/** Withdraw the open proposals of a question that is being asked again. Best effort: never throws. */
export async function cancelTurnActions(admin: Admin, userId: string, turnId: string): Promise<void> {
  try {
    await admin
      .from("assistant_actions")
      .update({ status: "cancelled", error: "The question was asked again.", updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("turn_id", turnId)
      .eq("status", "proposed");
  } catch {
    /* no action table yet (migration 0087), or a blip: nothing to withdraw */
  }
}

/** Proposals nobody acted on in time stop being confirmable. */
export async function expireStale(admin: Admin, now = new Date()): Promise<number> {
  const { data, error } = await admin
    .from("assistant_actions")
    .update({ status: "expired", updated_at: now.toISOString() })
    .in("status", ["proposed", "awaiting_approval"])
    .lt("expires_at", now.toISOString())
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

/** The card the browser draws for a stored action. */
export function toCard(row: StoredAction, now = Date.now()): ActionCard {
  const c = (row.card ?? {}) as Partial<ActionCard>;
  const expired = (row.status === "proposed" || row.status === "awaiting_approval") && Date.parse(row.expires_at) < now;
  const status = expired ? "expired" : row.status;
  const card: ActionCard = {
    id: row.id,
    key: row.action_key,
    title: row.title,
    group: c.group ?? "",
    risk: row.risk,
    status,
    confirmLabel: c.confirmLabel ?? "Confirm",
    fields: c.fields ?? [],
    changes: c.changes,
    items: c.items,
    warnings: c.warnings,
    notes: c.notes,
    link: c.link ?? null,
    confirmPhrase: row.risk === "critical" ? row.confirm_phrase : null,
    result: row.result ? { message: row.result.message, link: row.result.link ?? null } : null,
    error: row.error,
    undoUntil: row.undo_until,
    plan: row.plan_id ? { id: row.plan_id, index: row.plan_index ?? 0, total: c.plan?.total ?? 0, title: row.plan_title ?? "" } : null,
    approval: c.approval ? { ...c.approval, note: row.approval_note ?? c.approval.note ?? null } : null,
    callId: row.tool_call_id,
    turnId: row.turn_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
  if (card.status === "done" && !canUndo(card, now)) card.undoUntil = null;
  return card;
}

/* ------------------------------------------------------- admin switches */

export interface ActionSetting {
  enabled: boolean;
  require_approval: boolean;
}

let settingsCache: { at: number; map: Map<string, ActionSetting> } | null = null;
const SETTINGS_TTL_MS = 15_000;

/** Per-action switches (no row = on, no approval). Cached briefly; never throws. */
export async function getActionSettings(admin: Admin): Promise<Map<string, ActionSetting>> {
  if (settingsCache && Date.now() - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.map;
  const map = new Map<string, ActionSetting>();
  const { data, error } = await admin.from("assistant_action_settings").select("action_key, enabled, require_approval");
  if (!error) for (const r of data ?? []) map.set(r.action_key as string, { enabled: Boolean(r.enabled), require_approval: Boolean(r.require_approval) });
  settingsCache = { at: Date.now(), map };
  return map;
}

export function clearActionSettingsCache() {
  settingsCache = null;
}

export async function saveActionSetting(admin: Admin, key: string, patch: Partial<ActionSetting>, by: string): Promise<void> {
  const current = (await getActionSettings(admin)).get(key) ?? { enabled: true, require_approval: false };
  const { error } = await admin
    .from("assistant_action_settings")
    .upsert({ action_key: key, ...current, ...patch, updated_by: by, updated_at: new Date().toISOString() }, { onConflict: "action_key" });
  if (error) throw new Error(error.message);
  clearActionSettingsCache();
}

/** Migration 0087 not applied yet. */
export function isMissingActionTables(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /assistant_(actions|action_settings|reminders|recipes|handoffs|rules|channel_links|link_codes|uploads)/.test(msg) && /(does not exist|schema cache|could not find)/i.test(msg);
}

export const ACTIONS_MIGRATION_MESSAGE =
  "SED AI's action mode is not set up yet. An admin needs to apply migration 0087_assistant_actions.sql.";
