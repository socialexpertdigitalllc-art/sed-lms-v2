import { notify } from "@/lib/notifications/notify";

export async function notifyFeedback(opts: {
  eventKey: "feedback_submitted" | "feedback_resolved";
  feedbackId: string;
  feedback?: { user_id: string | null } | null;
  actorId?: string | null;
  title: string;
  body: string;
  nonce: string;
}) {
  await notify(
    opts.eventKey,
    { feedback: opts.feedback ?? null, actorId: opts.actorId ?? null },
    { title: opts.title, body: opts.body, dedupKey: `${opts.eventKey}:${opts.feedbackId}:${opts.nonce}`, targetUrl: "/feedback" }
  );
}
