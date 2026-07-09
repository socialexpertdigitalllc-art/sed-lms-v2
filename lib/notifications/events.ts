export const NOTIFICATION_EVENTS = [
  {
    key: "followup_reminder",
    label: "Follow-up reminder",
    description: "Remind the lead's agent before a scheduled follow-up.",
    defaultLeadTimeMinutes: 15,
    hasTiming: true,
  },
  {
    key: "ticket_opened",
    label: "Ticket opened (needs assignment)",
    description: "A sales user opened a ticket that needs an admin to assign a developer.",
    defaultLeadTimeMinutes: 0,
    hasTiming: false,
  },
  {
    key: "ticket_assigned",
    label: "Ticket assigned to you",
    description: "An admin assigned a ticket to you.",
    defaultLeadTimeMinutes: 0,
    hasTiming: false,
  },
  {
    key: "ticket_resolved",
    label: "Ticket resolved",
    description: "A developer resolved a ticket you opened.",
    defaultLeadTimeMinutes: 0,
    hasTiming: false,
  },
  {
    key: "ticket_reopened",
    label: "Ticket reopened",
    description: "A resolved ticket assigned to you was reopened.",
    defaultLeadTimeMinutes: 0,
    hasTiming: false,
  },
  {
    key: "ticket_overdue",
    label: "Ticket overdue",
    description: "A ticket passed its due date and was escalated.",
    defaultLeadTimeMinutes: 0,
    hasTiming: false,
  },
  {
    key: "feedback_submitted",
    label: "Feedback submitted",
    description: "A user submitted dashboard feedback.",
    defaultLeadTimeMinutes: 0,
    hasTiming: false,
  },
  {
    key: "feedback_resolved",
    label: "Feedback resolved",
    description: "Your feedback was resolved.",
    defaultLeadTimeMinutes: 0,
    hasTiming: false,
  },
] as const;

export type NotificationEventKey = (typeof NOTIFICATION_EVENTS)[number]["key"];

export function eventDefault(key: string) {
  return NOTIFICATION_EVENTS.find((e) => e.key === key);
}
