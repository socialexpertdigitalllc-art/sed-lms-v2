// lib/forms/deliver.ts
import nodemailer from "nodemailer";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAppSettings } from "@/lib/settings/appSettings";
import { getMailboxById } from "@/lib/mail/mailbox";
import { buildSmtpConfig } from "@/lib/mail/config";
import type { ResolvedMailbox } from "@/lib/mail/types";
import { notify } from "@/lib/notifications/notify";
import { buildFormEmail, previewLine } from "@/lib/forms/email";
import { isEmailAddress } from "@/lib/forms/parse";
import { CLAIM_STALE_MS } from "@/lib/forms/types";
import type { FormEndpointRow, FormSubmissionRow } from "@/lib/forms/types";

/** Seam so tests never touch SMTP. */
export type SendFn = (msg: nodemailer.SendMailOptions, mailbox: ResolvedMailbox) => Promise<void>;

export const smtpSend: SendFn = async (msg, mailbox) => {
  // Explicit timeouts: nodemailer's defaults (2min connect, 10min socket)
  // would let ONE stalled SMTP connection eat the sweep route's whole
  // maxDuration budget.
  const transport = nodemailer.createTransport({
    ...buildSmtpConfig(mailbox),
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  await transport.sendMail(msg);
};

/** endpoint.mailbox_id → app_settings.form_default_mailbox_id → null. */
export async function resolveSender(endpoint: Pick<FormEndpointRow, "mailbox_id">): Promise<ResolvedMailbox | null> {
  if (endpoint.mailbox_id) {
    const m = await getMailboxById(endpoint.mailbox_id);
    if (m) return m;
  }
  const settings = await getAppSettings();
  const fallback = (settings as { form_default_mailbox_id?: string | null }).form_default_mailbox_id ?? null;
  return fallback ? getMailboxById(fallback) : null;
}

export type DeliveryResult = { status: "sent" } | { status: "skipped" } | { status: "failed"; error: string };

/**
 * Deliver one stored submission by email. Idempotent: spam and already-sent
 * rows are skipped. Called from the submit route's after() and from the
 * retry sweep. Never throws — every outcome lands on the row.
 */
export async function deliverSubmission(id: string, deps: { send?: SendFn } = {}): Promise<DeliveryResult> {
  const send = deps.send ?? smtpSend;
  const admin = createAdminClient();

  const { data: sub } = await admin.from("form_submissions").select("*").eq("id", id).maybeSingle();
  if (!sub) return { status: "failed", error: "Submission not found" };
  const submission = sub as FormSubmissionRow;
  if (submission.is_spam || submission.delivery_status === "sent") return { status: "skipped" };
  // A row another worker is sending RIGHT NOW is off-limits until its claim
  // goes stale (worker died mid-send). Without the status flip below, a
  // sweep tick during an in-flight send would re-claim and double-email.
  if (
    submission.delivery_status === "sending" &&
    submission.claimed_at &&
    Date.now() - new Date(submission.claimed_at).getTime() < CLAIM_STALE_MS
  ) {
    return { status: "skipped" };
  }

  // CLAIM before sending: after() and the sweep can race, and a duplicate
  // email cannot be undone after send(). Optimistic-concurrency update —
  // only the caller whose read still matches wins, and the status flips to
  // 'sending' so later readers back off instead of re-claiming.
  const { data: claimed } = await admin
    .from("form_submissions")
    .update({ delivery_status: "sending", claimed_at: new Date().toISOString(), delivery_attempts: submission.delivery_attempts + 1 })
    .eq("id", submission.id)
    .eq("delivery_status", submission.delivery_status)
    .eq("delivery_attempts", submission.delivery_attempts)
    .select("id");
  if (!claimed || claimed.length === 0) return { status: "skipped" };

  // From here the row is claimed ('sending'): every exit MUST resolve it to
  // sent or failed, or it strands as 'sending' until the stale-claim sweep —
  // and forever, once attempts hit the max. Hence the catch-all below.
  try {
    return await deliverClaimed(admin, submission, send);
  } catch (e) {
    return fail(admin, submission, (e as Error).message || "Delivery crashed");
  }
}

async function deliverClaimed(
  admin: ReturnType<typeof createAdminClient>,
  submission: FormSubmissionRow,
  send: SendFn,
): Promise<DeliveryResult> {
  const { data: ep } = await admin.from("form_endpoints").select("*").eq("id", submission.endpoint_id).maybeSingle();
  if (!ep) return fail(admin, submission, "Endpoint no longer exists");
  const endpoint = ep as FormEndpointRow;
  if (!endpoint.to_emails.length) return fail(admin, submission, "Endpoint has no recipients");

  const mailbox = await resolveSender(endpoint);
  if (!mailbox) return fail(admin, submission, "No sender mailbox configured");

  const built = buildFormEmail({
    endpointName: endpoint.name,
    subject: submission.subject || `New form submission from ${endpoint.name}`,
    payload: submission.payload ?? [],
    origin: submission.origin,
    createdAt: submission.created_at,
  });
  const fromName = `${(submission.submitter_name || endpoint.name).replace(/["\\\r\n]/g, "")} via SED LMS`;
  const msg: nodemailer.SendMailOptions = {
    from: `"${fromName}" <${mailbox.address}>`,
    to: endpoint.to_emails,
    subject: built.subject,
    text: built.text,
    html: built.html,
  };
  if (submission.submitter_email && isEmailAddress(submission.submitter_email)) msg.replyTo = submission.submitter_email;
  if (submission.cc_email && isEmailAddress(submission.cc_email)) msg.cc = submission.cc_email;

  try {
    await send(msg, mailbox);
  } catch (e) {
    return fail(admin, submission, (e as Error).message || "Send failed");
  }

  await admin
    .from("form_submissions")
    .update({ delivery_status: "sent", delivered_at: new Date().toISOString(), mailbox_id: mailbox.id, last_error: null, delivery_attempts: submission.delivery_attempts + 1 })
    .eq("id", submission.id);

  try {
    let lead: { agent_id: string | null; closed_by: string | null } | null = null;
    if (submission.lead_id) {
      const { data } = await admin.from("leads").select("id, agent_id, closed_by").eq("id", submission.lead_id).maybeSingle();
      if (data) lead = { agent_id: data.agent_id ?? null, closed_by: data.closed_by ?? null };
    }
    await notify(
      "form_submission_received",
      { leadId: submission.lead_id, lead },
      {
        title: `New form submission — ${endpoint.name}`,
        body: previewLine(submission.payload ?? []) || built.subject,
        dedupKey: `form_submission:${submission.id}`,
        targetUrl: `/forms?submission=${submission.id}`,
      },
    );
  } catch { /* bell is best-effort — the email really was sent */ }

  return { status: "sent" };
}

async function fail(admin: ReturnType<typeof createAdminClient>, s: FormSubmissionRow, error: string): Promise<DeliveryResult> {
  await admin
    .from("form_submissions")
    .update({ delivery_status: "failed", delivery_attempts: s.delivery_attempts + 1, last_error: error.slice(0, 500) })
    .eq("id", s.id);
  return { status: "failed", error };
}
