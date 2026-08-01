import { eventDefault } from "./events";

export function effectiveSetting(
  eventKey: string,
  row: { enabled: boolean; lead_time_minutes: number } | undefined | null
): { enabled: boolean; leadTimeMinutes: number } {
  if (row) return { enabled: row.enabled, leadTimeMinutes: row.lead_time_minutes };
  const d = eventDefault(eventKey);
  return { enabled: true, leadTimeMinutes: d?.defaultLeadTimeMinutes ?? 15 };
}

/**
 * Per-user follow-up reminder gate. No settings row = remind for everything
 * (opt-out model). `statuses` null/empty = all statuses; otherwise the lead's
 * status must be selected.
 */
export function reminderAllowed(
  leadStatus: string,
  setting: { enabled: boolean; statuses?: string[] | null } | undefined | null,
): boolean {
  if (!setting) return true;
  if (!setting.enabled) return false;
  if (setting.statuses && setting.statuses.length > 0) return setting.statuses.includes(leadStatus);
  return true;
}

/** True when `now` is in [followUpTime - leadTimeMinutes, followUpTime). */
export function shouldRemind(
  followUpTime: string | null,
  leadTimeMinutes: number,
  now: Date = new Date()
): boolean {
  if (!followUpTime) return false;
  const t = new Date(followUpTime).getTime();
  if (Number.isNaN(t)) return false;
  const opens = t - leadTimeMinutes * 60_000;
  const n = now.getTime();
  return n >= opens && n < t;
}
