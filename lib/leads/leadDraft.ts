import type { NewLeadFormState } from "@/lib/leads/newLeadForm";

/**
 * The New Lead form's unsent draft, kept on this device (localStorage) until
 * the lead is submitted or the agent presses "Clear form". It survives a
 * refresh, a closed tab or window, a crash and a shut-down computer, so a
 * failed submit (a VPN, a dropped connection) never costs the agent the lead.
 *
 * One draft per person per browser (`lead-draft:v1:<user id>`), so someone
 * else signing in on the same computer never sees it. Every storage call is
 * guarded: private mode or a full disk just means no draft.
 */

export const LEAD_DRAFT_VERSION = 1;
export const leadDraftKey = (userId: string) => `lead-draft:v${LEAD_DRAFT_VERSION}:${userId || "anon"}`;

export type LeadDraft = { v: number; savedAt: number; form: Partial<NewLeadFormState> };

export function loadLeadDraft(userId: string): LeadDraft | null {
  try {
    const raw = window.localStorage.getItem(leadDraftKey(userId));
    if (!raw) return null;
    const d = JSON.parse(raw) as LeadDraft;
    if (!d || d.v !== LEAD_DRAFT_VERSION || typeof d.form !== "object" || !d.form) return null;
    return d;
  } catch {
    return null;
  }
}

/** Save the form, or forget the draft when the form is back to blank. */
export function saveLeadDraft(userId: string, form: NewLeadFormState, blank: string, now: number = Date.now()): void {
  try {
    if (JSON.stringify(form) === blank) {
      window.localStorage.removeItem(leadDraftKey(userId));
      return;
    }
    const d: LeadDraft = { v: LEAD_DRAFT_VERSION, savedAt: now, form };
    window.localStorage.setItem(leadDraftKey(userId), JSON.stringify(d));
  } catch {
    /* private mode / quota: the form still works, it just isn't kept */
  }
}

export function clearLeadDraft(userId: string): void {
  try {
    window.localStorage.removeItem(leadDraftKey(userId));
  } catch {
    /* nothing to clear */
  }
}

/**
 * A saved draft laid over a fresh form: fields added since the draft was saved
 * keep their defaults, list fields are always lists, and a status the person
 * can no longer set falls back to the fresh one.
 */
export function mergeLeadDraft(
  fresh: NewLeadFormState,
  draft: Partial<NewLeadFormState>,
  allowedStatuses: string[] | null,
): NewLeadFormState {
  const out = { ...fresh } as Record<string, unknown>;
  for (const [k, v] of Object.entries(draft)) {
    if (!(k in fresh)) continue;
    const base = (fresh as unknown as Record<string, unknown>)[k];
    if (Array.isArray(base)) {
      if (Array.isArray(v)) out[k] = v;
      else if (typeof v === "string") out[k] = v ? [v] : base; // an older single-text field
    } else if (v !== undefined && v !== null && typeof v === typeof base) {
      out[k] = v;
    }
  }
  const merged = out as unknown as NewLeadFormState;
  if (allowedStatuses && !allowedStatuses.includes(merged.status)) merged.status = fresh.status;
  return merged;
}
