import { FEEDBACK_TYPES } from "@/lib/feedback/types";
import { readUpload } from "../../uploads";
import type { CardLink } from "../card";
import { formatDateTime, UPLOAD_PREFIX } from "../fields";
import { isStepRef, need, plural, str } from "../helpers";
import { callRoute, RouteError } from "../invoke";
import type { ActionContext, ActionDef, Problem, Values } from "../types";

/**
 * Personal actions: reminders, the bell, feedback to the team.
 *
 * Reminders are SED AI's own state (assistant_reminders — there is no app
 * endpoint for them), so they are written here directly with the service
 * role, always scoped to their owner; the scheduler turns a due reminder into
 * a bell notification. The bell and feedback go through the app's own
 * endpoints (see ../invoke.ts).
 */

const notificationReadRoute = () => import("@/app/api/notifications/[id]/read/route");
const feedbackRoute = () => import("@/app/api/feedback/route");

/** A refusal in our own words where no endpoint is involved — shown to the person as is. */
const refuse = (message: string, status = 409) => new RouteError(message, status, null);

/* ------------------------------------------------------- reminder.create */

type ReminderStatus = "pending" | "sent" | "cancelled";
interface ReminderRow {
  id: string;
  text: string;
  remind_at: string;
  status: ReminderStatus;
}

async function ownReminder(ctx: ActionContext, id: unknown): Promise<ReminderRow | null> {
  if (typeof id !== "string" || isStepRef(id)) return null;
  const { data } = await ctx.admin.from("assistant_reminders").select("id, text, remind_at, status").eq("id", id).eq("user_id", ctx.userId).maybeSingle();
  return (data as ReminderRow | null) ?? null;
}

/** What the reminder opens: the ticket, else the lead. "@1" (a plan step's record) has no link yet. */
function reminderLink(v: Values): CardLink | null {
  const real = (x: unknown): x is string => typeof x === "string" && !isStepRef(x);
  if (real(v.ticket)) return { href: `/tickets/${v.ticket}`, label: "Open ticket" };
  if (real(v.lead)) return { href: `/leads/${v.lead}`, label: "Open lead" };
  return null;
}

/**
 * Whose reminder it is: the person who asked. Normally that is who confirms
 * it, but an approver confirming someone's request must not get the reminder.
 */
async function requesterOf(ctx: ActionContext, actionId: string): Promise<string> {
  const { data } = await ctx.admin.from("assistant_actions").select("user_id").eq("id", actionId).maybeSingle();
  const owner = (data as { user_id?: unknown } | null)?.user_id;
  return typeof owner === "string" ? owner : ctx.userId;
}

const reminderCreate: ActionDef = {
  key: "reminder.create",
  group: "Personal",
  title: "Set a reminder",
  description:
    "Remind the person at a time they choose with a bell notification — \"remind me tomorrow at 10am to call Jumbo's\". Ask what to remind them of and when, if they did not say. When it is about a lead or a ticket, link it so the reminder opens that record.",
  confirmLabel: "Set reminder",
  risk: "standard",
  allowed: () => null,
  // Only ever about the person's own reminders: never run by an approver in their place.
  selfOnly: true,
  fields: [
    { name: "text", label: "Remind me to", type: "text", required: true, max: 500, help: "What to be reminded of, in their words: \"call Jumbo's about the logo\"." },
    { name: "remind_at", label: "When", type: "datetime", required: true, future: true, help: "When the reminder goes off. Ask if they gave no time." },
    { name: "lead", label: "Lead", type: "ref", ref: "lead", editable: false, help: "Optional: the lead it is about — the reminder opens it." },
    { name: "ticket", label: "Ticket", type: "ref", ref: "ticket", editable: false, help: "Optional: the ticket it is about — the reminder opens it." },
  ],
  label: (v) => str(v.text),
  produces: "reminder",
  minutesSaved: 1,
  async preview(v, ctx) {
    const when = formatDateTime(str(v.remind_at), ctx.timezone, ctx.now);
    const about = typeof v.ticket === "string" ? "ticket" : typeof v.lead === "string" ? "lead" : null;
    return {
      title: `Remind me ${when}: ${str(v.text)}`,
      notes: [`A bell notification at ${when} (${ctx.timezone})${about ? ` that opens the ${about}` : ""}. Only you get it.`],
      link: reminderLink(v),
    };
  },
  async execute(v, ctx, info) {
    const lead = typeof v.lead === "string" ? v.lead : null;
    const ticket = typeof v.ticket === "string" ? v.ticket : null;
    const { data, error } = await ctx.admin
      .from("assistant_reminders")
      .insert({
        user_id: await requesterOf(ctx, info.actionId),
        text: str(v.text),
        remind_at: str(v.remind_at),
        lead_id: lead,
        ticket_id: ticket,
        target_url: ticket ? `/tickets/${ticket}` : lead ? `/leads/${lead}` : null,
        status: "pending",
        action_id: info.actionId,
      })
      .select("id")
      .single();
    const id = (data as { id?: unknown } | null)?.id;
    if (error || typeof id !== "string") throw new Error(error?.message ?? "The reminder could not be saved.");
    return {
      message: `Reminder set for ${formatDateTime(str(v.remind_at), ctx.timezone, ctx.now)}: ${str(v.text)}.`,
      link: reminderLink(v),
      data: { id, kind: "reminder" },
    };
  },
  undo: {
    async run(stored, ctx) {
      const id = stored.result?.data?.id;
      if (typeof id !== "string") throw refuse("Nothing to undo.");
      const { data, error } = await ctx.admin
        .from("assistant_reminders")
        .update({ status: "cancelled" })
        .eq("id", id)
        .eq("user_id", stored.user_id)
        .eq("status", "pending")
        .select("id");
      if (error) throw new Error(error.message);
      if (!(data as unknown[] | null)?.length) throw refuse("The reminder has already gone off.");
      return "the reminder is cancelled.";
    },
  },
};

/* ------------------------------------------------------- reminder.cancel */

const reminderCancel: ActionDef = {
  key: "reminder.cancel",
  group: "Personal",
  title: "Cancel a reminder",
  description: "Cancel one of the person's own reminders before it goes off, found by what it says (\"the Jumbo's reminder\").",
  confirmLabel: "Cancel reminder",
  risk: "standard",
  allowed: () => null,
  // Only ever about the person's own reminders: never run by an approver in their place.
  selfOnly: true,
  fields: [{ name: "reminder", label: "Reminder", type: "ref", ref: "reminder", required: true, editable: false, help: "Which reminder, by what it says (or its id)." }],
  label: (v) => str(v.__name),
  minutesSaved: 1,
  async check(v, ctx) {
    if (typeof v.reminder !== "string" || isStepRef(v.reminder)) return {};
    const r = await ownReminder(ctx, v.reminder);
    if (!r) return { problems: [{ field: "reminder", message: "That reminder was not found among yours." }] };
    const problems: Problem[] =
      r.status === "pending" ? [] : [{ field: "reminder", message: r.status === "sent" ? "That reminder has already gone off." : "That reminder is already cancelled." }];
    return { problems, values: { __name: r.text } };
  },
  async preview(v, ctx) {
    const r = await ownReminder(ctx, v.reminder);
    return {
      title: `Cancel the reminder “${r?.text ?? str(v.__name)}”`,
      notes: r ? [`It was due ${formatDateTime(r.remind_at, ctx.timezone, ctx.now)}.`] : undefined,
      before: r ? { status: r.status, remind_at: r.remind_at } : null,
    };
  },
  async stale(_before, v, ctx) {
    const r = await ownReminder(ctx, v.reminder);
    if (!r) return "the reminder no longer exists.";
    return r.status === "pending" ? null : r.status === "sent" ? "it has already gone off." : "it was already cancelled.";
  },
  async execute(v, ctx) {
    const id = str(v.reminder);
    // Only while still pending: a reminder that went off meanwhile stays as it is.
    const { data, error } = await ctx.admin
      .from("assistant_reminders")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("user_id", ctx.userId)
      .eq("status", "pending")
      .select("id");
    if (error) throw new Error(error.message);
    if (!(data as unknown[] | null)?.length) throw refuse("That reminder is no longer pending — it went off or was cancelled.");
    return { message: `Cancelled the reminder “${str(v.__name)}”.`, data: { id } };
  },
  undo: {
    async run(stored, ctx) {
      const { data, error } = await ctx.admin
        .from("assistant_reminders")
        .update({ status: "pending" })
        .eq("id", str(stored.input.reminder))
        .eq("user_id", stored.user_id)
        .eq("status", "cancelled")
        .select("id, remind_at");
      if (error) throw new Error(error.message);
      const row = (data as { remind_at: string }[] | null)?.[0];
      if (!row) throw refuse("The reminder can no longer be restored.");
      return Date.parse(row.remind_at) <= ctx.now.getTime() ? "the reminder is back on (its time has passed, so it goes off right away)." : "the reminder is back on.";
    },
  },
};

/* ----------------------------------------------------- notification.read */

const BELLS = ["general", "website"] as const;

/** The person's unread notifications (their own client: RLS shows only theirs). */
async function unreadIds(ctx: ActionContext, bell: unknown, deliveredOnly: boolean): Promise<string[]> {
  let q = ctx.db.from("notifications").select("id").eq("user_id", ctx.userId).is("read_at", null);
  if (bell === "general" || bell === "website") q = q.eq("bell", bell);
  // What the bells show: a delayed notification is not delivered (visible) yet.
  if (deliveredOnly) q = q.lte("deliver_after", ctx.now.toISOString());
  const { data } = await q.limit(1000);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

const notificationRead: ActionDef = {
  key: "notification.read",
  group: "Personal",
  title: "Mark notifications read",
  description:
    "Mark the person's own bell notifications as read: particular ones (by their title), or all unread ones (\"mark all as read\") — optionally only the general bell or only the website bell.",
  confirmLabel: "Mark read",
  risk: "standard",
  allowed: () => null,
  // Only ever about the person's own notifications: never run by an approver in their place.
  selfOnly: true,
  fields: [
    { name: "all", label: "All unread", type: "boolean", default: false, help: "true for \"mark all as read\"; otherwise name the notifications." },
    { name: "bell", label: "Bell", type: "enum", options: BELLS, showIf: (v) => v.all === true, help: "Optional with all: only the general bell or only the website bell. Leave out for both." },
    {
      name: "notifications",
      label: "Notifications",
      type: "refs",
      ref: "notification",
      required: true,
      max: 200,
      editable: false,
      showIf: (v) => v.all !== true,
      help: "Which notifications, by their title (or ids). Or set all = true.",
    },
  ],
  minutesSaved: 0.5,
  async check(v, ctx) {
    if (v.all === true) {
      if ((await unreadIds(ctx, v.bell, true)).length) return {};
      return { problems: [{ field: "_", message: `You have no unread notifications${typeof v.bell === "string" ? ` on the ${v.bell} bell` : ""}.` }] };
    }
    if (!Array.isArray(v.notifications) || !v.notifications.length) return {};
    const { data } = await ctx.db.from("notifications").select("id, read_at").eq("user_id", ctx.userId).in("id", v.notifications as string[]);
    const rows = (data ?? []) as { id: string; read_at: string | null }[];
    if (rows.length && rows.every((r) => r.read_at)) {
      return { problems: [{ field: "notifications", message: rows.length === 1 ? "That notification is already read." : "Those notifications are already read." }] };
    }
    return {};
  },
  async preview(v, ctx) {
    if (v.all === true) {
      const n = (await unreadIds(ctx, v.bell, true)).length;
      const where = typeof v.bell === "string" ? ` on the ${v.bell} bell` : "";
      return { title: n === 1 ? `Mark the 1 unread notification${where} read` : `Mark all ${n} unread notifications${where} read` };
    }
    return { title: `Mark ${plural((v.notifications as string[]).length, "notification")} read` };
  },
  async execute(v, ctx) {
    if (v.all === true) {
      // Exactly what the endpoint marks (every unread one), so Undo can put them back.
      const ids = await unreadIds(ctx, v.bell, false);
      await callRoute(notificationReadRoute, "POST", {
        path: "/api/notifications/all/read",
        params: { id: "all" },
        search: { bell: typeof v.bell === "string" ? v.bell : undefined },
      });
      return { message: `Marked ${plural(ids.length, "notification")} read.`, data: { ids }, undoable: ids.length > 0 };
    }
    const { data } = await ctx.db.from("notifications").select("id").eq("user_id", ctx.userId).is("read_at", null).in("id", v.notifications as string[]);
    const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
    for (const id of ids) await callRoute(notificationReadRoute, "POST", { path: `/api/notifications/${id}/read`, params: { id } });
    return { message: `Marked ${plural(ids.length, "notification")} read.`, data: { ids }, undoable: ids.length > 0 };
  },
  undo: {
    async run(stored, ctx) {
      const ids = (stored.result?.data?.ids as string[] | undefined) ?? [];
      if (!ids.length) throw refuse("Nothing to undo.");
      // No endpoint marks a notification unread. The read endpoint itself
      // writes with the service role scoped to the owner (notifications have
      // no update policy) — so does this, for the same rows it just marked.
      const { error } = await ctx.admin.from("notifications").update({ read_at: null }).eq("user_id", stored.user_id).in("id", ids);
      if (error) throw new Error(error.message);
      return `${plural(ids.length, "notification")} unread again.`;
    },
  },
};

/* ------------------------------------------------------- feedback.submit */

const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024; // the feedback endpoint's own limit
const FEEDBACK_NOUN: Record<string, string> = { Bug: "bug report", "Feature request": "feature request", Other: "feedback" };

const feedbackSubmit: ActionDef = {
  key: "feedback.submit",
  group: "Personal",
  title: "Send feedback",
  description:
    "Send feedback or a bug report about the app to the team, like the Feedback page: the type (Bug, Feature request or Other), a short title, the details, and optionally a screenshot attached in this chat.",
  confirmLabel: "Send feedback",
  risk: "standard",
  allowed: (ctx) => need(ctx, "feedback.submit"),
  // Feedback in the person's own name: never sent by an approver in their place.
  selfOnly: true,
  fields: [
    { name: "type", label: "Type", type: "enum", options: FEEDBACK_TYPES, required: true, help: "Bug = something is broken; Feature request = an idea or wish; Other = anything else." },
    { name: "title", label: "Title", type: "text", required: true, max: 200, help: "A one-line summary." },
    { name: "description", label: "Details", type: "longtext", max: 4000, help: "What happened, the steps, what they expected — in their words." },
    { name: "screenshot", label: "Screenshot", type: "attachment", help: "Optional: an image attached in this chat (up to 5 MB)." },
  ],
  label: (v) => str(v.title),
  minutesSaved: 2,
  async check(v, ctx) {
    if (typeof v.screenshot !== "string") return {};
    // The endpoint takes a file and silently drops one that is not an image
    // under 5 MB — say so now rather than lose it.
    if (!v.screenshot.startsWith(UPLOAD_PREFIX)) {
      return { problems: [{ field: "screenshot", message: "Attach the screenshot as a file in this chat — a link cannot be uploaded (it can go in the details instead)." }] };
    }
    const { data } = await ctx.admin.from("assistant_uploads").select("mime, size_bytes").eq("id", v.screenshot.slice(UPLOAD_PREFIX.length)).eq("user_id", ctx.ownerId ?? ctx.userId).maybeSingle();
    const file = data as { mime: string; size_bytes: number } | null;
    const problems: Problem[] = [];
    if (!file) problems.push({ field: "screenshot", message: "That attached file is gone — attach it again." });
    else if (!file.mime.startsWith("image/")) problems.push({ field: "screenshot", message: "The screenshot must be an image." });
    else if (file.size_bytes > SCREENSHOT_MAX_BYTES) problems.push({ field: "screenshot", message: "The screenshot must be 5 MB or smaller." });
    return { problems };
  },
  async preview(v) {
    return {
      title: `Feedback (${str(v.type)}): ${str(v.title)}`,
      notes: ["The team that handles feedback is notified. You can follow it on the Feedback page."],
      link: { href: "/feedback", label: "Open Feedback" },
    };
  },
  async execute(v, ctx) {
    // The Feedback form's request: a JSON "payload" part plus an optional "screenshot" file.
    const form = new FormData();
    form.append("payload", JSON.stringify({ type: v.type, title: str(v.title), description: str(v.description).trim() || null }));
    if (typeof v.screenshot === "string" && v.screenshot.startsWith(UPLOAD_PREFIX)) {
      const { row, blob } = await readUpload(ctx.admin, ctx.ownerId ?? ctx.userId, v.screenshot.slice(UPLOAD_PREFIX.length));
      form.append("screenshot", new File([blob], row.name, { type: row.mime }));
    }
    const res = await callRoute<{ feedback?: { id?: string } }>(feedbackRoute, "POST", { path: "/api/feedback", form });
    return {
      message: `Sent your ${FEEDBACK_NOUN[str(v.type)] ?? "feedback"} “${str(v.title)}” to the team.`,
      link: { href: "/feedback", label: "Open Feedback" },
      data: { id: res.feedback?.id ?? null },
    };
  },
};

export const PERSONAL_ACTIONS: ActionDef[] = [reminderCreate, reminderCancel, notificationRead, feedbackSubmit];
