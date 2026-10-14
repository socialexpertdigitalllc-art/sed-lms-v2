import { allowedFormScope, leadInScope, submissionInScope } from "@/lib/forms/access";
import { endpointInputSchema } from "@/lib/forms/schema";
import { htmlSnippet, relaySubmitUrl } from "@/lib/forms/snippet";
import type { FormEndpointRow, FormSubmissionRow } from "@/lib/forms/types";
import { isValidTimezone, US_TIMEZONE_OPTIONS } from "@/lib/geo/timezones";
import type { Lead } from "@/lib/leads/types";
import { formatDateTime, isBlank } from "../fields";
import { isStepRef, need, str, visibleLead } from "../helpers";
import { callRoute, RouteError } from "../invoke";
import type { ActionDef, CheckResult, Problem, Values } from "../types";
import { cardRows, EMAIL_RE, recipientWarnings, row, verifiedMailboxes } from "./email";

/**
 * Client contact forms (Form Relay): set up a form endpoint for a client's
 * website, and re-send a submission's email. Both run through the Forms
 * endpoints (forms.manage) with the same scope rule as the Forms screens: a
 * manager without leads.view_all works only on leads they are the agent or
 * closer of.
 */

const endpointsRoute = () => import("@/app/api/forms/endpoints/route");
const endpointRoute = () => import("@/app/api/forms/endpoints/[id]/route");
const resendRoute = () => import("@/app/api/forms/submissions/[id]/resend/route");

const endpointLink = (id: string) => ({ href: `/forms/endpoints/${id}`, label: "Open the form & its snippet" });

/** The endpoint schema's hostname rule. */
const HOST_RE = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** A site as people paste it ("https://acme.com/contact") → the hostname the endpoint stores. */
export function originHost(s: string): string {
  const t = s.trim().toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(t)) {
    try {
      return new URL(t).hostname;
    } catch {
      return t;
    }
  }
  const host = t.replace(/[/?#].*$/, "").replace(/:\d+$/, "");
  // A bare ".acme.com" means the wildcard: no hostname starts with a dot.
  return host.startsWith(".") ? `*${host}` : host;
}

/* ------------------------------------------------------------ form.setup */

/** The endpoint's payload, as the endpoint editor sends it. */
function endpointPayload(v: Values): Record<string, unknown> {
  return {
    name: str(v.name).trim(),
    lead_id: typeof v.lead === "string" && !isStepRef(v.lead) ? v.lead : null,
    to_emails: Array.isArray(v.to_emails) ? v.to_emails : [],
    subject_template: str(v.subject_template).trim(),
    mailbox_id: typeof v.__mailbox_id === "string" ? v.__mailbox_id : null,
    allowed_origins: Array.isArray(v.allowed_origins) ? v.allowed_origins : [],
    daily_limit: typeof v.daily_limit === "number" ? v.daily_limit : 200,
    success_redirect_url: typeof v.success_redirect_url === "string" ? v.success_redirect_url : null,
    timezone: typeof v.timezone === "string" ? v.timezone : null,
    status: v.status === "paused" ? "paused" : "active",
  };
}

const PAYLOAD_FIELD: Record<string, string> = { lead_id: "lead", mailbox_id: "mailbox" };

const formSetup: ActionDef = {
  key: "form.setup",
  group: "Client forms",
  title: "Set up a contact form for a client's site",
  description:
    "Create a contact-form endpoint for a client's website (Forms → Endpoints): visitors' submissions are emailed to the client. Usually tied to the client's lead, whose business name and email become the defaults. Ask for the client site's address to lock the form to it. The result gives the access key and the submit URL; the ready-to-paste snippet is on the form's page.",
  confirmLabel: "Create form",
  risk: "standard",
  allowed: (ctx) => need(ctx, "forms.manage"),
  fields: [
    {
      name: "lead",
      label: "Client lead",
      type: "ref",
      ref: "lead",
      editable: false,
      help: "The client's lead: its page lists the submissions and its agent is told about each one. Leave out only for a form that belongs to no lead.",
    },
    { name: "name", label: "Name", type: "text", max: 120, required: (v) => isBlank(v.lead), help: 'What the form is called, e.g. "Acme Roofing – contact" (default: the lead\'s business + " – contact").' },
    {
      name: "to_emails",
      label: "Send submissions to",
      type: "list",
      max: 10,
      required: (v) => isBlank(v.lead),
      help: "The client's address(es) that receive each submission (default: the lead's email).",
    },
    { name: "subject_template", label: "Subject", type: "text", max: 200, help: "The email subject: {site} = the form's name, {name} = the visitor. Leave out for the default." },
    {
      name: "mailbox",
      label: "Sender mailbox",
      type: "enum",
      options: async (ctx) => (await verifiedMailboxes(ctx)).map((m) => m.email_address),
      help: "The company mailbox the submission emails come from. Leave out for the default sender (Admin › Settings).",
    },
    {
      name: "allowed_origins",
      label: "Allowed sites",
      type: "list",
      max: 20,
      help: "The client site's hostnames (acme.com, or *.acme.com for it and every subdomain) — only they may post. Leave out to allow any site.",
    },
    { name: "daily_limit", label: "Daily limit", type: "integer", min: 1, max: 10_000, default: 200, help: "Most submissions accepted a day (default 200)." },
    { name: "success_redirect_url", label: "Thank-you page", type: "url", help: "Where a plain-HTML form goes after sending (optional)." },
    {
      name: "timezone",
      label: "Email timezone",
      type: "text",
      max: 64,
      help: `The zone for the received-at time in each email, e.g. ${US_TIMEZONE_OPTIONS.map((o) => o.value).join(", ")}. Leave out for automatic (the lead's area, else Eastern).`,
    },
    { name: "status", label: "Status", type: "enum", options: ["active", "paused"], default: "active", help: "paused = submissions are refused (default active)." },
  ],
  label: (v) => str(v.name || v.__name),
  produces: "form_endpoint",
  minutesSaved: 4,
  async check(v, ctx): Promise<CheckResult> {
    const problems: Problem[] = [];
    const warnings: string[] = [];
    const values: Values = {};
    const stepLead = isStepRef(v.lead);
    const lead = stepLead ? null : await visibleLead<Lead>(ctx, v.lead);
    if (typeof v.lead === "string" && !stepLead && !lead) problems.push({ field: "lead", message: "That lead is not visible to you." });

    let site = "";
    if (lead) {
      values.__name = lead.business_name;
      // The endpoint's own scope rule: agent or closer, unless leads.view_all.
      if (!leadInScope(lead.id, await allowedFormScope(ctx.admin, ctx.userId, ctx.perms))) {
        problems.push({ field: "lead", message: "You can only add a form to a lead you are the agent or closer of." });
      }
      // The editor's defaults when a lead is picked.
      if (isBlank(v.name)) values.name = `${lead.business_name} – contact`.slice(0, 120);
      if (isBlank(v.to_emails)) {
        const email = lead.no_email ? "" : str(lead.business_email).trim().toLowerCase();
        if (EMAIL_RE.test(email)) values.to_emails = [email];
        else problems.push({ field: "to_emails", message: `${lead.business_name} has no email address — who should receive the submissions?` });
      }
      const { data: existing } = await ctx.admin.from("form_endpoints").select("name, status").eq("lead_id", lead.id).limit(3);
      for (const e of (existing ?? []) as { name: string; status: string }[]) warnings.push(`${lead.business_name} already has a contact form, "${e.name}" (${e.status}) — this adds another.`);
      try {
        site = lead.website_link ? new URL(lead.website_link).hostname.replace(/^www\./, "") : "";
      } catch {
        site = "";
      }
    }

    const to = (values.to_emails ?? v.to_emails) as string[] | undefined;
    if (Array.isArray(to)) {
      const bad = to.filter((a) => !EMAIL_RE.test(a));
      if (bad.length) problems.push({ field: "to_emails", message: `Not email addresses: ${bad.join(", ")}.` });
      for (const w of await Promise.all(to.filter((a) => EMAIL_RE.test(a)).map((a) => recipientWarnings("to_emails", a)))) warnings.push(...w);
    }

    if (Array.isArray(v.allowed_origins)) {
      const hosts = (v.allowed_origins as string[]).map(originHost);
      values.allowed_origins = hosts;
      const bad = hosts.filter((h) => !HOST_RE.test(h));
      if (bad.length) problems.push({ field: "allowed_origins", message: `Not a site's hostname: ${bad.join(", ")} — use e.g. acme.com or *.acme.com.` });
      // acme.com does not cover www.acme.com (lib/forms/gate.ts): say so.
      for (const h of hosts.filter((x) => HOST_RE.test(x) && !x.startsWith("*.") && x.split(".").length === 2)) {
        if (!hosts.includes(`www.${h}`) && !hosts.includes(`*.${h}`)) warnings.push(`${h} does not cover www.${h} — use *.${h} if the site is also served with www.`);
      }
    } else if (lead || !isBlank(v.to_emails)) {
      warnings.push(`Any website can post to this form${site ? ` — add ${site} as an allowed site to keep spam out` : ""}.`);
    }

    if (typeof v.timezone === "string" && !isValidTimezone(v.timezone)) problems.push({ field: "timezone", message: `${v.timezone} is not a timezone — use one like America/Chicago.` });

    if (typeof v.mailbox === "string") {
      const hit = (await verifiedMailboxes(ctx)).find((m) => m.email_address === v.mailbox);
      if (hit) values.__mailbox_id = hit.id;
      else problems.push({ field: "mailbox", message: `${v.mailbox} is not a verified mailbox any more — pick another.` });
    }

    // Finally the endpoint's own schema, on the payload it will receive (once
    // nothing above is wrong — it would only repeat it less clearly).
    const parsed = problems.length ? null : endpointInputSchema.safeParse(endpointPayload({ ...v, ...values }));
    if (parsed && !parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        const field = PAYLOAD_FIELD[key] ?? (key || "_");
        if (!problems.some((p) => p.field === field)) problems.push({ field, message: `${field.replace(/_/g, " ")}: ${issue.message}` });
      }
    }
    return { problems, warnings, values };
  },
  async preview(v, ctx) {
    const to = Array.isArray(v.to_emails) ? (v.to_emails as string[]) : [];
    return {
      title: `Contact form “${str(v.name)}” → ${to.join(", ")}`,
      fields: await cardRows(formSetup, v, ctx, isBlank(v.mailbox) ? { last: [row("sender", "Sender mailbox", "The default form sender (Admin › Settings)")] } : {}),
      notes: [
        `Each submission is emailed to ${to.join(", ") || "the client"}${isBlank(v.lead) ? "" : ", and the lead's agent is told"}.`,
        "You get an access key and a snippet to paste into the client's site.",
      ],
      link: typeof v.lead === "string" && !isStepRef(v.lead) ? { href: `/leads/${v.lead}`, label: "Open lead" } : null,
    };
  },
  async execute(v, ctx) {
    // check() worked the mailbox out moments ago; looked up again if it could not run.
    let mailboxId = typeof v.__mailbox_id === "string" ? v.__mailbox_id : null;
    if (typeof v.mailbox === "string" && !mailboxId) {
      mailboxId = (await verifiedMailboxes(ctx)).find((m) => m.email_address === v.mailbox)?.id ?? null;
      if (!mailboxId) throw new RouteError(`${v.mailbox} is not a verified mailbox any more.`, 409, null);
    }
    const res = await callRoute<{ endpoint: FormEndpointRow }>(endpointsRoute, "POST", {
      path: "/api/forms/endpoints",
      body: endpointPayload({ ...v, __mailbox_id: mailboxId }),
    });
    const e = res.endpoint;
    const url = relaySubmitUrl();
    return {
      message: `Created the contact form “${e.name}”. Access key: ${e.access_key} — the client's form posts to ${url}. The ready-to-paste snippet is on the form's page.`,
      link: endpointLink(e.id),
      data: { id: e.id, kind: "form_endpoint", access_key: e.access_key, submit_url: url, html_snippet: htmlSnippet({ url, accessKey: e.access_key }) },
    };
  },
  undo: {
    async run(stored, ctx) {
      const id = str(stored.result?.data?.id);
      // Deleting an endpoint deletes its submissions: never once it has any.
      const { data } = await ctx.admin.from("form_submissions").select("id").eq("endpoint_id", id).limit(1);
      if ((data ?? []).length) throw new RouteError("It has already received a submission — delete it on the Forms screen if you really mean to.", 409, null);
      await callRoute(endpointRoute, "DELETE", { path: `/api/forms/endpoints/${id}`, params: { id } });
      return "the form was deleted again.";
    },
  },
};

/* ----------------------------------------------------------- form.resend */

type Submission = Pick<
  FormSubmissionRow,
  "id" | "endpoint_id" | "lead_id" | "subject" | "submitter_name" | "submitter_email" | "is_spam" | "delivery_status" | "delivered_at" | "created_at"
>;

const formResend: ActionDef = {
  key: "form.resend",
  group: "Client forms",
  title: "Re-send a form submission",
  description:
    "Email a stored contact-form submission to the client again, now (the Forms inbox's Re-send) — e.g. when the first email failed or the client lost it. A submission marked as spam has to be marked not-spam first (that delivers it).",
  confirmLabel: "Re-send",
  risk: "sensitive",
  allowed: (ctx) => need(ctx, "forms.manage"),
  fields: [
    { name: "submission", label: "Submission", type: "ref", ref: "form_submission", required: true, editable: false, help: "The visitor's name or email, or the subject." },
  ],
  label: (v) => str(v.__name),
  minutesSaved: 1,
  async check(v, ctx): Promise<CheckResult> {
    if (typeof v.submission !== "string") return {};
    const { data } = await ctx.admin
      .from("form_submissions")
      .select("id, endpoint_id, lead_id, subject, submitter_name, submitter_email, is_spam, delivery_status, delivered_at, created_at")
      .eq("id", v.submission)
      .maybeSingle();
    const sub = data as Submission | null;
    // The endpoint's own rule: outside your leads it does not exist.
    if (!sub || !submissionInScope(sub, await allowedFormScope(ctx.admin, ctx.userId, ctx.perms))) {
      return { problems: [{ field: "submission", message: "That submission is not visible to you." }] };
    }
    const problems: Problem[] = [];
    const warnings: string[] = [];
    if (sub.is_spam) problems.push({ field: "submission", message: "It is marked as spam — mark it as not spam first (that also delivers it)." });
    if (sub.delivery_status === "sent") {
      warnings.push(`It was already delivered${sub.delivered_at ? ` on ${formatDateTime(sub.delivered_at, ctx.timezone, ctx.now)}` : ""} — the client gets it a second time.`);
    }
    const { data: ep } = await ctx.admin.from("form_endpoints").select("name, to_emails").eq("id", sub.endpoint_id).maybeSingle();
    const endpoint = ep as Pick<FormEndpointRow, "name" | "to_emails"> | null;
    if (!endpoint) problems.push({ field: "submission", message: "Its form no longer exists." });
    else if (!endpoint.to_emails?.length) problems.push({ field: "submission", message: `The form “${endpoint.name}” has no recipients.` });
    return {
      problems,
      warnings,
      values: {
        __name: str(sub.submitter_name || sub.submitter_email || "Submission"),
        __subject: sub.subject,
        __to: (endpoint?.to_emails ?? []).join(", "),
        __form: endpoint?.name ?? "",
      },
    };
  },
  async preview(v, ctx) {
    return {
      title: `Re-send ${str(v.__name)}${v.__subject ? ` — “${str(v.__subject)}”` : ""} to ${str(v.__to)}`,
      fields: await cardRows(formResend, v, ctx, { last: [row("form", "Form", str(v.__form)), row("to", "To", str(v.__to))] }),
      notes: ["The client gets the submission email again, now.", "An email cannot be unsent — there is no undo."],
      link: { href: `/forms?submission=${str(v.submission)}`, label: "Open the submission" },
    };
  },
  async execute(v) {
    const id = str(v.submission);
    const res = await callRoute<{ result?: { status: string; error?: string } }>(resendRoute, "POST", { path: `/api/forms/submissions/${id}/resend`, params: { id } });
    // The endpoint answers 200 even when delivery fails: the outcome is in `result`.
    const status = res.result?.status;
    if (status === "failed") throw new RouteError(`It could not be sent: ${res.result?.error ?? "delivery failed"}.`, 502, res);
    if (status !== "sent") throw new RouteError("Another delivery of this submission is already under way — check it on the Forms screen in a minute.", 409, res);
    const to = str(v.__to);
    return {
      message: `Re-sent the submission from ${str(v.__name)}${to ? ` to ${to}` : ""}.`,
      link: { href: `/forms?submission=${id}`, label: "Open the submission" },
      data: { id, kind: "form_submission" },
    };
  },
};

export const FORM_ACTIONS: ActionDef[] = [formSetup, formResend];
