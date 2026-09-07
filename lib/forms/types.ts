// lib/forms/types.ts
export type FormEndpointStatus = "active" | "paused";
export type FormDeliveryStatus = "pending" | "sending" | "sent" | "failed" | "skipped";
export type FormSpamReason = "honeypot" | "origin" | "rate_ip" | "rate_daily" | "manual";

/** Row of public.form_endpoints. */
export interface FormEndpointRow {
  id: string;
  lead_id: string | null;
  name: string;
  access_key: string;
  to_emails: string[];
  subject_template: string;
  mailbox_id: string | null;
  allowed_origins: string[];
  daily_limit: number;
  success_redirect_url: string | null;
  status: FormEndpointStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** One submitted field, in submission order. */
export type PayloadField = { key: string; value: string };

/** Row of public.form_submissions. */
export interface FormSubmissionRow {
  id: string;
  endpoint_id: string;
  lead_id: string | null;
  payload: PayloadField[];
  subject: string;
  submitter_name: string | null;
  submitter_email: string | null;
  ip: string | null;
  user_agent: string | null;
  origin: string | null;
  referer: string | null;
  is_spam: boolean;
  spam_reason: FormSpamReason | null;
  delivery_status: FormDeliveryStatus;
  delivery_attempts: number;
  claimed_at: string | null;
  cc_email: string | null;
  last_error: string | null;
  delivered_at: string | null;
  mailbox_id: string | null;
  read_at: string | null;
  created_at: string;
}

export const MAX_DELIVERY_ATTEMPTS = 5;

/** A 'sending' claim older than this is stale (worker died mid-send) and may be retaken. */
export const CLAIM_STALE_MS = 10 * 60_000;

/** Endpoint row + today's non-spam count (GET /api/forms/endpoints and the Endpoints page). */
export type EndpointListItem = FormEndpointRow & { today_count: number };

/** Submission row + display names (GET /api/forms/submissions, the inbox and the drawer). */
export type SubmissionListItem = FormSubmissionRow & { endpoint_name: string | null; lead_name: string | null };
