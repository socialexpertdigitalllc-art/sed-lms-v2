export const NOTIFICATION_EVENTS = [
  {
    key: "followup_reminder",
    label: "Follow-up reminder",
    description: "Remind the lead's agent before a scheduled follow-up.",
    defaultLeadTimeMinutes: 15,
    hasTiming: true,
  },
] as const;

export type NotificationEventKey = (typeof NOTIFICATION_EVENTS)[number]["key"];

export function eventDefault(key: string) {
  return NOTIFICATION_EVENTS.find((e) => e.key === key);
}
