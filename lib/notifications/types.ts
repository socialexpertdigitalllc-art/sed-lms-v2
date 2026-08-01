export type ContextualRole =
  | "lead_agent"
  | "lead_closer"
  | "ticket_assignee"
  | "ticket_creator"
  | "feedback_submitter"
  | "mailbox_owner"
  | "contract_creator";
export type NotifyBell = "website" | "general";

export interface NotificationRule {
  event_key: string;
  enabled: boolean;
  target_departments: string[];
  target_users: string[];
  target_roles: ContextualRole[];
  delay_minutes: number;
}

export interface NotifyContext {
  leadId?: string | null;
  lead?: { agent_id: string | null; closed_by: string | null } | null;
  ticket?: { assigned_to: string | null; created_by: string | null } | null;
  feedback?: { user_id: string | null } | null;
  mailbox?: { user_id: string | null } | null;
  contract?: { created_by: string | null } | null;
  actorId?: string | null;
}

export interface AppNotification {
  id: string;
  event_key: string;
  lead_id: string | null;
  target_url: string | null;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
  bell: NotifyBell;
  /** Live-site URL for website notifications — powers "open in new tab". */
  website_url?: string | null;
}
