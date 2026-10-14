import { readUpload } from "../../uploads";
import type { CardField } from "../card";
import { checkEmail } from "../checks";
import { cardFields, isBlank, normalizeFields, UPLOAD_PREFIX } from "../fields";
import { str } from "../helpers";
import { callRoute } from "../invoke";
import type { ActionContext, ActionDef, CheckResult, Problem, Values } from "../types";

/**
 * Email: SED AI writes an email and sends it from the person's own mailbox
 * once they confirm. SERVER ONLY.
 *
 * THE CARD IS THE DRAFT. The mail feature has no drafts — the compose drawer
 * keeps its draft in the browser, and POST /api/mail/send is the only way a
 * message leaves — so there is no separate "draft" action: email.send's
 * proposal shows the whole email (From, To, Cc, Subject, the message) with
 * the subject and message editable, and nothing is sent until Send is pressed.
 *
 * FROM IS ALWAYS THE PERSON'S OWN MAILBOX. /api/mail/send never takes a
 * mailbox from the client (lib/mail/guard.ts), not even for mail.manage, so
 * there is no "send as" field.
 *
 * Also the small helpers the Money and Client-forms actions share: the
 * verified mailboxes a sender can be picked from, the card rows, and the
 * deliverability check for an address something is sent to.
 */

const mailSendRoute = () => import("@/app/api/mail/send/route");

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* -------------------------------------------------------- shared helpers */

export interface MailboxRow {
  id: string;
  email_address: string;
  display_name: string | null;
  user_id: string | null;
  created_at?: string;
}

/**
 * Verified company mailboxes: what the contract composer and the form editor
 * offer as a sender. Read the way those pages read them (service role, behind
 * the action's own permission) — never the credentials.
 */
export async function verifiedMailboxes(ctx: ActionContext): Promise<MailboxRow[]> {
  const { data } = await ctx.admin.from("company_mailboxes").select("id, email_address, display_name, user_id, created_at").eq("status", "verified").order("email_address");
  return (data ?? []) as MailboxRow[];
}

/** The person's own send-from mailbox: their earliest verified one (what /api/mail/send sends from). */
export async function ownMailbox(ctx: ActionContext): Promise<MailboxRow | null> {
  const { data } = await ctx.admin
    .from("company_mailboxes")
    .select("id, email_address, display_name, user_id, created_at")
    .eq("user_id", ctx.userId)
    .eq("status", "verified")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as MailboxRow | null) ?? null;
}

export const mailboxLabel = (m: Pick<MailboxRow, "email_address" | "display_name">): string =>
  m.display_name ? `${m.display_name} <${m.email_address}>` : m.email_address;

/**
 * The card's rows with every value as the person reads it. The framework's
 * own card shows values a check() worked out (a default taken from the
 * record) as blank, so a preview that fills defaults builds its rows here.
 */
export async function cardRows(def: ActionDef, v: Values, ctx: ActionContext, extra: { first?: CardField[]; last?: CardField[] } = {}): Promise<CardField[]> {
  const n = await normalizeFields(def, v, ctx, { stepRefs: true });
  return [...(extra.first ?? []), ...(await cardFields(def, n, ctx)), ...(extra.last ?? [])];
}

/** A read-only card row. */
export const row = (name: string, label: string, value: string): CardField => ({ name, label, value, edit: null });

/**
 * Deliverability of an address something is about to be SENT to. Even a
 * certain failure is only a warning: the send screens let a person "send
 * anyway", and the card puts it in front of them before they confirm.
 */
export async function recipientWarnings(field: string, email: string): Promise<string[]> {
  const out = await checkEmail(field, email);
  return [...out.problems.map((p) => p.message.replace(/, or say the business has no email\./, ".")), ...out.warnings];
}

/* ------------------------------------------------------------ email.send */

/** The compose drawer's combined attachment cap. */
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const ccOf = (v: Values): string[] => (Array.isArray(v.cc) ? (v.cc as string[]) : []);
const filesOf = (v: Values): string[] => (Array.isArray(v.attachments) ? (v.attachments as string[]) : []);

const emailSend: ActionDef = {
  key: "email.send",
  group: "Email",
  title: "Write and send an email",
  description:
    "Write an email for the person and send it from THEIR OWN company mailbox once they confirm. The card is the draft: it shows From, To, Cc, Subject and the whole message, and the person can edit the subject and message before pressing Send — there is no separate draft step, and nothing is sent until then. Write the complete message yourself (plain text, signed with the person's name). Ask who it goes to when that is not clear from the conversation or the record (e.g. the lead's email). Files attached in this chat can go with it.",
  confirmLabel: "Send email",
  risk: "sensitive",
  // No permission key: anyone with a verified mailbox of their own may send.
  // That is data, not a permission, so check() is where it is said.
  allowed: () => null,
  fields: [
    { name: "to", label: "To", type: "email", required: true, help: "The recipient's email address (one). Ask if it is not clear." },
    { name: "cc", label: "Cc", type: "list", max: 20, editable: true, help: "Other addresses to copy (optional)." },
    { name: "subject", label: "Subject", type: "text", max: 500, help: "A short, specific subject line." },
    {
      name: "body",
      label: "Message",
      type: "longtext",
      max: 100_000,
      help: "The full email text as it will be sent (plain text), ending with the person's name. The person can edit it on the card.",
    },
    {
      name: "attachments",
      label: "Attachments",
      type: "attachments",
      max: 10,
      help: "Files attached in this chat to send along (optional). Web links cannot be attached — put them in the message.",
    },
  ],
  label: (v) => str(v.subject),
  minutesSaved: 4,
  async check(v, ctx): Promise<CheckResult> {
    const problems: Problem[] = [];
    const warnings: string[] = [];
    const mine = await ownMailbox(ctx);
    if (!mine) {
      problems.push({ field: "_", message: "You have no verified mailbox of your own, so SED AI cannot send email for you. An admin can link one in Admin → Mail." });
    }

    const cc = ccOf(v);
    const badCc = cc.filter((a) => !EMAIL_RE.test(a));
    if (badCc.length) problems.push({ field: "cc", message: `Not email addresses: ${badCc.join(", ")}.` });
    else if (cc.join(", ").length > 2000) problems.push({ field: "cc", message: "Too many Cc addresses (2,000 characters at most)." });

    // The endpoint takes file contents, so only chat files can be attached.
    const files = filesOf(v);
    if (files.some((f) => !f.startsWith(UPLOAD_PREFIX))) {
      problems.push({ field: "attachments", message: "Only files attached in this chat can go with the email — put web links in the message instead." });
    }
    const ids = files.filter((f) => f.startsWith(UPLOAD_PREFIX)).map((f) => f.slice(UPLOAD_PREFIX.length));
    if (ids.length) {
      const { data } = await ctx.admin.from("assistant_uploads").select("id, size_bytes").eq("user_id", ctx.userId).in("id", ids);
      const total = ((data ?? []) as { size_bytes: number | null }[]).reduce((sum, r) => sum + Number(r.size_bytes ?? 0), 0);
      if (total > MAX_ATTACHMENT_BYTES) problems.push({ field: "attachments", message: "The attachments add up to more than 20 MB — leave some out." });
    }

    const addresses = [...(typeof v.to === "string" ? [v.to] : []), ...cc.filter((a) => EMAIL_RE.test(a))];
    for (const w of await Promise.all(addresses.map((a) => recipientWarnings("to", a)))) warnings.push(...w);
    if (!isBlank(v.to)) {
      if (isBlank(v.subject)) warnings.push("There is no subject line.");
      if (isBlank(v.body)) warnings.push("The message is empty.");
    }
    return { problems, warnings, values: mine ? { __from: mailboxLabel(mine), __mailbox_id: mine.id } : {} };
  },
  async preview(v, ctx) {
    const from = str(v.__from);
    return {
      title: `Email ${str(v.to)}${v.subject ? ` — ${str(v.subject)}` : " (no subject)"}`,
      fields: await cardRows(emailSend, v, ctx, { first: [row("from", "From", from)] }),
      notes: ["It goes out from your own mailbox as soon as you press Send, and a copy is kept in its Sent folder.", "An email cannot be unsent — there is no undo."],
      link: { href: "/mailbox", label: "Open Mailbox" },
      // The stale check: the mailbox it was shown going out from.
      before: { mailbox_id: v.__mailbox_id ?? null, from },
    };
  },
  async stale(before, _v, ctx) {
    // The endpoint sends from whoever presses Send: an approver (or a
    // re-linked mailbox) would send it from a mailbox the card did not show.
    const b = (before ?? {}) as { mailbox_id?: string | null; from?: string };
    const mine = await ownMailbox(ctx);
    if (!mine) return "you no longer have a verified mailbox to send from.";
    if (b.mailbox_id && mine.id !== b.mailbox_id) return `it would now go out from ${mailboxLabel(mine)}, not ${b.from || "the mailbox shown"}.`;
    return null;
  },
  async execute(v, ctx) {
    const attachments: { filename: string; contentBase64: string; contentType: string }[] = [];
    for (const f of filesOf(v)) {
      if (!f.startsWith(UPLOAD_PREFIX)) continue;
      const { row: file, blob } = await readUpload(ctx.admin, ctx.ownerId ?? ctx.userId, f.slice(UPLOAD_PREFIX.length));
      attachments.push({
        filename: file.name.slice(0, 255),
        contentBase64: Buffer.from(await blob.arrayBuffer()).toString("base64"),
        contentType: file.mime || "application/octet-stream",
      });
    }
    const cc = ccOf(v);
    await callRoute(mailSendRoute, "POST", {
      path: "/api/mail/send",
      body: { to: v.to, cc: cc.join(", "), subject: str(v.subject), body: str(v.body), attachments },
    });
    return {
      message: `Sent ${v.subject ? `“${str(v.subject)}”` : "the email"} to ${str(v.to)}${cc.length ? ` (cc ${cc.join(", ")})` : ""}.`,
      link: { href: "/mailbox", label: "Open Mailbox" },
      data: { to: v.to, subject: str(v.subject) },
    };
  },
};

export const EMAIL_ACTIONS: ActionDef[] = [emailSend];
