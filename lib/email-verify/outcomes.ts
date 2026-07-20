import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail } from "./syntax";
import type { OutcomeRow, SendOutcome } from "./scorecard";

/**
 * Send outcomes — the ground truth behind the accuracy scorecard. SERVER ONLY.
 *
 * Rows are written by the cron mail poller when it sees a bounce (NDR) land in
 * a linked company mailbox. Everything here is best-effort: recording a bounce
 * must never be able to break a poll run.
 */

export async function recordSendOutcome(input: {
  email: string;
  outcome: SendOutcome;
  mailboxId?: string | null;
  detectedAt?: string;
  source?: string;
}): Promise<boolean> {
  const normalized = normalizeEmail(input.email);
  if (!normalized) return false;
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("email_send_outcomes").insert({
      normalized_email: normalized,
      outcome: input.outcome,
      detected_at: input.detectedAt ?? new Date().toISOString(),
      mailbox_id: input.mailboxId ?? null,
      source: input.source ?? "mail_poll",
    });
    return !error;
  } catch {
    return false;
  }
}

/** Outcome rows for the stats route, newest first. */
export async function listSendOutcomes(limit = 5000): Promise<OutcomeRow[]> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("email_send_outcomes")
      .select("normalized_email, outcome, detected_at")
      .order("detected_at", { ascending: false })
      .limit(limit);
    return (data ?? []).map((r) => ({
      normalizedEmail: r.normalized_email as string,
      outcome: r.outcome as SendOutcome,
      detectedAt: r.detected_at as string,
    }));
  } catch {
    return [];
  }
}
