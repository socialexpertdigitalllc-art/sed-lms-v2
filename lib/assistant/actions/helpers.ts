import { PERMISSIONS } from "@/lib/permissions/constants";
import type { CardChange } from "./card";
import { STEP_REF_RE } from "./fields";
import type { ActionContext, Values } from "./types";

/** Small pieces every action definition uses. SERVER ONLY. */

const permName = (key: string) => {
  const known = PERMISSIONS.find((p) => p.key === key)?.name;
  if (known) return known;
  // Per-status keys: leads.cat_set.long_term → Set leads to "Long Term".
  const cat = /^leads\.cat_(set|view)\.(.+)$/.exec(key);
  if (cat) {
    const status = cat[2].split("_").map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ");
    return cat[1] === "set" ? `Set leads to ${status}` : `See ${status} leads`;
  }
  return key;
};

/**
 * null when the person holds every permission; otherwise the reason, naming
 * the first missing one the way the admin screens do.
 */
export function need(ctx: ActionContext, ...keys: string[]): string | null {
  const missing = keys.find((k) => !ctx.perms.has(k));
  return missing ? `Your account doesn't have “${permName(missing)}”.` : null;
}

/** Endpoints that also require Admin-department membership. */
export function needAdmin(ctx: ActionContext, ...keys: string[]): string | null {
  return need(ctx, ...keys) ?? (ctx.isAdmin ? null : "Only members of the Admin department can do this.");
}

/** Whose own things (attached files, reminders) this action uses: the requester's, also when an approver runs it. */
export const ownerOf = (ctx: ActionContext): string => ctx.ownerId ?? ctx.userId;

/** "@2": a plan step's record, not yet created. */
export const isStepRef = (v: unknown): v is string => typeof v === "string" && STEP_REF_RE.test(v.trim());

export const str = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));

/** A lead the person can see (their own client), or null. */
export async function visibleLead<T = Record<string, unknown>>(ctx: ActionContext, id: unknown, columns = "*"): Promise<T | null> {
  if (typeof id !== "string" || isStepRef(id)) return null;
  const { data } = await ctx.db.from("leads").select(columns).eq("id", id).is("deleted_at", null).maybeSingle();
  return (data as T | null) ?? null;
}

/** "Changes": label, before → after, for the fields whose value differs. */
export function changesOf(
  before: Record<string, unknown>,
  after: Values,
  labels: Record<string, string>,
  show: (field: string, v: unknown) => string = (_f, v) => displayValue(v),
): CardChange[] {
  const out: CardChange[] = [];
  for (const [k, v] of Object.entries(after)) {
    if (!(k in labels)) continue;
    const from = show(k, before[k]);
    const to = show(k, v);
    if (from !== to) out.push({ label: labels[k], from: from || "—", to: to || "—" });
  }
  return out;
}

export function displayValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (Array.isArray(v)) return v.map(displayValue).filter(Boolean).join(", ");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Compare a stored before-state's updated_at with the record now. */
export function movedOn(before: unknown, now: { updated_at?: string | null } | null): string | null {
  const b = before as { updated_at?: string | null } | null;
  if (!now) return "the record no longer exists (or you can no longer see it).";
  if (b?.updated_at && now.updated_at && b.updated_at !== now.updated_at) return "it was changed by someone else after this was proposed.";
  return null;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
