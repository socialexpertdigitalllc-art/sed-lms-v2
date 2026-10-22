import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * COMPANY MILESTONES — every 1,000 leads (1,000, 2,000, 3,000…) everyone in
 * the company gets a one-time celebration the next time they open the app.
 * Once per person: the highest milestone they have seen is kept in their own
 * profiles.ui_preferences.milestones.leads, so it never comes back — not after
 * a refresh, not on another device — until the next thousand.
 *
 * The count is the company's live leads (what the Leads page shows; archived
 * ones don't count). A celebration is for the moment: someone who joins long
 * after a milestone isn't shown an old party.
 */

export const LEAD_MILESTONE_STEP = 1000;
/** After this long, a milestone isn't shown to someone who missed it. */
export const MILESTONE_FRESH_MS = 30 * 24 * 3_600_000;

/** The highest milestone a count has reached (0 below the first). PURE. */
export function leadMilestone(count: number): number {
  return count >= LEAD_MILESTONE_STEP ? Math.floor(count / LEAD_MILESTONE_STEP) * LEAD_MILESTONE_STEP : 0;
}

/** The highest milestone this person has already celebrated (their ui_preferences). PURE. */
export function seenMilestone(uiPreferences: unknown): number {
  const m = (uiPreferences as { milestones?: { leads?: unknown } } | null)?.milestones?.leads;
  return typeof m === "number" && Number.isFinite(m) && m > 0 ? m : 0;
}

/**
 * The milestone to celebrate with this person now, or null: reached, not yet
 * seen by them, and recent enough to still be news. PURE; tested.
 */
export function pendingMilestone(p: { count: number; seen: number; reachedAt: string | null; now: Date }): number | null {
  const m = leadMilestone(p.count);
  if (!m || m <= p.seen) return null;
  if (p.reachedAt && p.now.getTime() - Date.parse(p.reachedAt) > MILESTONE_FRESH_MS) return null;
  return m;
}

/** What the celebration shows. */
export interface MilestoneCelebration {
  milestone: number;
  /** The live lead count right now (≥ milestone). */
  total: number;
  /** Leads this person is the agent on. */
  mine: number;
  /** Deals the company has closed. */
  closed: number;
  /** People on the team (active accounts). */
  team: number;
  /** When the company crossed it (the Nth live lead's creation). */
  reachedAt: string | null;
  /** The next one to aim for. */
  next: number;
}

type Admin = SupabaseClient;

async function liveLeadCount(admin: Admin): Promise<number> {
  const { count, error } = await admin.from("leads").select("id", { count: "exact", head: true }).is("deleted_at", null);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** When the company's Nth live lead was added. */
async function reachedAt(admin: Admin, n: number): Promise<string | null> {
  const { data } = await admin
    .from("leads")
    .select("created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .range(n - 1, n - 1);
  return ((data ?? [])[0] as { created_at?: string } | undefined)?.created_at ?? null;
}

async function preferences(admin: Admin, userId: string): Promise<Record<string, unknown>> {
  const { data, error } = await admin.from("profiles").select("ui_preferences").eq("id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  const p = (data as { ui_preferences?: unknown } | null)?.ui_preferences;
  return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
}

/**
 * The celebration owed to this person right now, or null (the usual answer:
 * one cheap count and one profile read).
 */
export async function celebrationFor(admin: Admin, userId: string, now = new Date()): Promise<MilestoneCelebration | null> {
  const [total, prefs] = await Promise.all([liveLeadCount(admin), preferences(admin, userId)]);
  const reached = leadMilestone(total);
  const seen = seenMilestone(prefs);
  if (!reached || reached <= seen) return null;
  const at = await reachedAt(admin, reached);
  const milestone = pendingMilestone({ count: total, seen, reachedAt: at, now });
  if (!milestone) return null;
  const [mine, closed, team] = await Promise.all([
    admin.from("leads").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("agent_id", userId),
    admin.from("leads").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("status", "Closed"),
    admin.from("profiles").select("id", { count: "exact", head: true }).not("is_active", "is", false),
  ]);
  return {
    milestone,
    total,
    mine: mine.count ?? 0,
    closed: closed.count ?? 0,
    team: team.count ?? 0,
    reachedAt: at,
    next: milestone + LEAD_MILESTONE_STEP,
  };
}

export class MilestoneError extends Error {}

/**
 * Record that this person has seen a milestone. Only one the company has
 * actually reached, and never lower than what they already saw.
 */
export async function markMilestoneSeen(admin: Admin, userId: string, milestone: number, now = new Date()): Promise<number> {
  if (!Number.isInteger(milestone) || milestone <= 0 || milestone % LEAD_MILESTONE_STEP !== 0) throw new MilestoneError("Not a milestone.");
  const [total, prefs] = await Promise.all([liveLeadCount(admin), preferences(admin, userId)]);
  if (milestone > leadMilestone(total)) throw new MilestoneError("The company hasn't reached that yet.");
  const seen = Math.max(seenMilestone(prefs), milestone);
  const current = (prefs.milestones && typeof prefs.milestones === "object" ? prefs.milestones : {}) as Record<string, unknown>;
  const { error } = await admin
    .from("profiles")
    .update({ ui_preferences: { ...prefs, milestones: { ...current, leads: seen, leadsSeenAt: now.toISOString() } } })
    .eq("id", userId);
  if (error) throw new Error(error.message);
  return seen;
}
