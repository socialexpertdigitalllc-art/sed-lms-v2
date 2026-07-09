export const FEEDBACK_TYPES = ["Bug", "Feature request", "Other"] as const;
export const FEEDBACK_STATUSES = ["Open", "Resolved"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export interface Feedback {
  id: string; user_id: string | null; type: FeedbackType; title: string; description: string | null;
  screenshot_path: string | null; status: FeedbackStatus; resolution_note: string | null;
  resolved_at: string | null; resolved_by: string | null; created_at: string;
  user_name?: string; screenshot_url?: string;
}
