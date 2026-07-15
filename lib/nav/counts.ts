/**
 * Sidebar badge wiring. Maps each nav `href` to the count key returned by
 * `/api/nav-counts`, and classifies which counts render in the alert palette
 * (overdue / unresolved / open work) vs. the neutral one. Kept pure so it can
 * be unit-tested and shared by the desktop rail and mobile overlay.
 *
 * Hrefs are the exact strings from the Sidebar nav arrays — keep them in sync.
 */
export const NAV_COUNT_BY_HREF: Record<string, string> = {
  "/leads": "leads",
  "/leads/follow-ups": "followups",
  "/tickets": "tickets",
  "/feedback": "feedback",
  "/payments": "payments",
  "/pre-leads/all": "preleads",
  "/admin/users": "users",
  "/admin/departments": "departments",
  "/admin/add-ons": "addons",
};

/** Counts that signal actionable/overdue work — rendered in the alert palette. */
const ALERT_KEYS = new Set(["followups", "tickets", "feedback"]);

export type NavCountTone = "default" | "alert";

/** The count key for a nav href, or undefined if that row has no badge. */
export function navCountKey(href: string): string | undefined {
  return NAV_COUNT_BY_HREF[href];
}

/** Badge palette for a count key. Unknown/undefined keys are neutral. */
export function navCountTone(key: string | undefined): NavCountTone {
  return key !== undefined && ALERT_KEYS.has(key) ? "alert" : "default";
}
