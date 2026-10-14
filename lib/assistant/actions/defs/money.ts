import { formatUsd, parsePrice } from "@/lib/contracts/merge";
import { CONTRACT_TEMPLATES, DEFAULT_TEMPLATE_KEY } from "@/lib/contracts/templates";
import type { Lead } from "@/lib/leads/types";
import { BILLING_MAILBOX_ADDRESS } from "@/lib/receipts/company";
import { billToName, computeTotals, formatMoney, formatShortDate, itemDisplayTitle, lineAmount, prefillItems, suggestNotes } from "@/lib/receipts/compute";
import { SERVICE_PRESETS } from "@/lib/receipts/presets";
import { receiptItemSchema } from "@/lib/receipts/schema";
import { PAYMENT_METHODS, RECEIPT_TERMS, type ReceiptItem, type ReceiptTerm, type ReceiptTotals } from "@/lib/receipts/types";
import type { CardField } from "../card";
import { isBlank, parseNumber, todayYmd } from "../fields";
import { isStepRef, need, str, visibleLead } from "../helpers";
import { callRoute, RouteError } from "../invoke";
import type { ActionContext, ActionDef, CheckResult, Problem, Values } from "../types";
import { cardRows, EMAIL_RE, mailboxLabel, recipientWarnings, row, verifiedMailboxes } from "./email";

/**
 * Money actions: issue a payment receipt and email it; draft a contract and
 * send it. Each runs through the same endpoint the lead page's Receipt and
 * Contract screens call (see ../invoke.ts), so the app's rules apply
 * unchanged. Issuing and sending are separate steps on purpose — exactly as
 * on the screens — so a plan can be "create the receipt, then send it @1".
 */

const receiptsRoute = () => import("@/app/api/leads/[id]/receipts/route");
const receiptSendRoute = () => import("@/app/api/receipts/[id]/send/route");
const contractsRoute = () => import("@/app/api/contracts/route");
const contractSendRoute = () => import("@/app/api/contracts/[id]/send/route");

const leadLink = (id: string, label = "Open lead") => ({ href: `/leads/${id}`, label });
const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);
/** A textarea's lines: one note per line, blanks dropped. */
const lines = (x: unknown): string[] =>
  str(x)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/* ------------------------------------------------------- receipt helpers */

/** The receipt form's default project title. */
const DEFAULT_PROJECT_TITLE = "Digital Services Package";

const TERM_WORDS: Record<string, ReceiptTerm> = {
  onetime: "one_time",
  once: "one_time",
  single: "one_time",
  monthly: "monthly",
  month: "monthly",
  permonth: "monthly",
  mo: "monthly",
  yearly: "yearly",
  year: "yearly",
  annual: "yearly",
  annually: "yearly",
  peryear: "yearly",
};

const LINES_HELP =
  'Give the services as a list like [{"title": "Custom Website Development", "term": "one_time", "qty": 1, "rate": 549}].';

/**
 * The service lines as the model sent them → the receipt's own line shape.
 * A known service (the form's presets) brings its description and usual
 * term, exactly as picking it in the form does.
 */
export function receiptLines(raw: unknown): { items: ReceiptItem[]; problem: string | null } {
  let list: unknown = raw;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return { items: [], problem: LINES_HELP };
    }
  }
  const entries = Array.isArray(list) ? list : [list];
  if (!entries.length) return { items: [], problem: "Add at least one service." };
  if (entries.length > 30) return { items: [], problem: "A receipt takes at most 30 services." };
  const items: ReceiptItem[] = [];
  for (const [i, entry] of entries.entries()) {
    const o = (entry && typeof entry === "object" ? entry : { title: entry }) as Record<string, unknown>;
    const title = str(o.title ?? o.name ?? o.service).trim();
    const which = `Service ${i + 1}${title ? ` (${title})` : ""}`;
    const preset = SERVICE_PRESETS.find((p) => p.title.toLowerCase() === title.toLowerCase());
    const termRaw = str(o.term ?? o.billing).trim();
    const term = (RECEIPT_TERMS as readonly string[]).includes(termRaw)
      ? (termRaw as ReceiptTerm)
      : termRaw
        ? TERM_WORDS[termRaw.toLowerCase().replace(/[^a-z]/g, "")]
        : (preset?.term ?? "one_time");
    if (!term) return { items: [], problem: `${which}: the term must be one_time, monthly or yearly.` };
    const rate = parseNumber(o.rate ?? o.price ?? o.amount);
    if (rate === null) return { items: [], problem: `${which} needs a price.` };
    const qtyRaw = o.qty ?? o.quantity;
    const parsed = receiptItemSchema.safeParse({
      title,
      description: str(o.description).trim() || preset?.description || "",
      term,
      qty: qtyRaw === undefined || qtyRaw === null || qtyRaw === "" ? 1 : (parseNumber(qtyRaw) ?? Number.NaN),
      rate,
    });
    if (!parsed.success) return { items: [], problem: `${which}: ${parsed.error.issues[0]?.message ?? "invalid"}.` };
    items.push(parsed.data);
  }
  return { items, problem: null };
}

function totalsLine(t: ReceiptTotals): string {
  const parts = [`subtotal ${formatMoney(t.subtotal)}`];
  if (t.discount > 0) parts.push(`discount −${formatMoney(t.discount)}`);
  if (t.taxAmount > 0) parts.push(`tax ${formatMoney(t.taxAmount)} (${t.taxRate}%)`);
  return parts.length > 1 ? `${formatMoney(t.total)} (${parts.join(", ")})` : formatMoney(t.total);
}

/** The fixed signer printed on every receipt (Receipt settings; empty = a blank signature line). */
async function receiptSigner(ctx: ActionContext): Promise<string> {
  const { data, error } = await ctx.admin.from("app_settings").select("receipt_signer_name").eq("singleton", true).maybeSingle();
  if (error || !data) return "";
  return str((data as { receipt_signer_name?: string | null }).receipt_signer_name).trim();
}

/**
 * Where receipts are emailed from — lib/receipts/settings.ts's own order
 * (the settings' mailbox, else the verified billing@ one), without loading
 * any credentials. Null: sending is impossible until a mailbox is linked.
 */
async function receiptSender(ctx: ActionContext): Promise<string | null> {
  const { data: s, error } = await ctx.admin.from("app_settings").select("receipt_mailbox_id").eq("singleton", true).maybeSingle();
  const id = error ? null : ((s as { receipt_mailbox_id?: string | null } | null)?.receipt_mailbox_id ?? null);
  if (id) {
    const { data: m } = await ctx.admin.from("company_mailboxes").select("email_address, display_name").eq("id", id).maybeSingle();
    if (m) return mailboxLabel(m as { email_address: string; display_name: string | null });
  }
  const { data: billing } = await ctx.admin
    .from("company_mailboxes")
    .select("email_address, display_name")
    .ilike("email_address", BILLING_MAILBOX_ADDRESS)
    .eq("status", "verified")
    .maybeSingle();
  return billing ? mailboxLabel(billing as { email_address: string; display_name: string | null }) : null;
}

/* -------------------------------------------------------- receipt.create */

const receiptCreate: ActionDef = {
  key: "receipt.create",
  group: "Money",
  title: "Create a payment receipt",
  description:
    "Issue a payment receipt for a client's lead (normally a Closed one) — the lead page's Receipt form. Ask how the client paid; everything else starts from the lead and shows on the card: the bill-to details, the lead's quoted prices as the service lines, today as the paid date, and suggested renewal notes. Give items only when the person says what was paid for or the amounts differ from the lead's quote. It does NOT email the receipt: use receipt.send afterwards (in a plan: receipt \"@1\").",
  confirmLabel: "Create receipt",
  // A permanent, numbered financial record: there is no way to delete one.
  risk: "sensitive",
  allowed: (ctx) => need(ctx, "receipts.send"),
  fields: [
    { name: "lead", label: "Lead", type: "ref", ref: "lead", required: true, editable: false, help: "The client's lead." },
    { name: "payment_method", label: "Paid via", type: "enum", options: PAYMENT_METHODS, required: true, help: "How the client paid. Ask — never assume." },
    {
      name: "paid_on",
      label: "Paid on",
      type: "date",
      default: (ctx: ActionContext) => todayYmd(ctx.timezone, ctx.now),
      help: "The day the payment arrived (default today).",
    },
    { name: "payment_reference", label: "Reference", type: "text", max: 120, help: "The transaction / confirmation id, if the person has one." },
    {
      name: "items",
      label: "Services",
      type: "json",
      hidden: true,
      help: `What was paid for, one entry per line: [{"title": "Custom Website Development", "term": "one_time" | "monthly" | "yearly", "qty": 1, "rate": 549, "description": "optional"}]. Leave out to use the lead's own pricing (the build at its quoted price, the yearly plan, priced add-ons).`,
    },
    { name: "discount", label: "Discount", type: "money", max: 999_999.99, help: "A flat dollar amount off (optional)." },
    { name: "tax_rate", label: "Tax %", type: "number", min: 0, max: 100, help: "Tax percent (optional, default 0)." },
    { name: "project_title", label: "Project title", type: "text", max: 160, default: DEFAULT_PROJECT_TITLE },
    { name: "bill_to_name", label: "Bill to", type: "text", max: 160, help: "The client's name (default: the lead's owner, else the business)." },
    { name: "bill_to_business", label: "Business", type: "text", max: 200, help: "Default: the lead's business name." },
    { name: "bill_to_email", label: "Bill-to email", type: "email", help: "Default: the lead's email." },
    { name: "bill_to_phone", label: "Bill-to phone", type: "text", max: 40, help: "Default: the lead's phone." },
    {
      name: "notes",
      label: "Notes",
      type: "longtext",
      max: 3_100,
      help: "Payment & coverage notes printed under the totals, one per line (at most 10). Default: the suggested renewal notes for the services.",
    },
    // The notes as last suggested: while the notes still equal it, they follow
    // the services and the paid date (as in the form, until edited by hand).
    { name: "notes_suggested", label: "Suggested notes", type: "longtext", max: 3_100, hidden: true, help: "Internal — leave out." },
  ],
  label: (v) => str(v.bill_to_business || v.__name),
  produces: "receipt",
  minutesSaved: 5,
  async check(v, ctx): Promise<CheckResult> {
    const problems: Problem[] = [];
    const warnings: string[] = [];
    const values: Values = {};
    const stepLead = isStepRef(v.lead);
    const lead = stepLead ? null : await visibleLead<Lead>(ctx, v.lead);
    if (typeof v.lead === "string" && !stepLead && !lead) problems.push({ field: "lead", message: "That lead is not visible to you." });

    if (lead) {
      values.__name = lead.business_name;
      // The form starts from the lead; so does this, where nothing was said.
      if (isBlank(v.bill_to_name)) values.bill_to_name = billToName(lead);
      if (isBlank(v.bill_to_business)) values.bill_to_business = lead.business_name;
      const email = str(lead.business_email).trim().toLowerCase();
      if (isBlank(v.bill_to_email) && !lead.no_email && EMAIL_RE.test(email)) values.bill_to_email = email;
      if (isBlank(v.bill_to_phone) && lead.business_phone) values.bill_to_phone = lead.business_phone;
      if (lead.status !== "Closed") warnings.push(`${lead.business_name} is ${lead.status}, not Closed — a receipt is normally issued once the deal is closed and paid.`);
      const { data: earlier } = await ctx.admin
        .from("lead_receipts")
        .select("receipt_no, total, paid_on, sent_at")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false })
        .limit(3);
      for (const r of (earlier ?? []) as { receipt_no: string; total: number | string; paid_on: string; sent_at: string | null }[]) {
        warnings.push(`It already has receipt ${r.receipt_no} (${formatMoney(Number(r.total))}, paid ${formatShortDate(r.paid_on)}, ${r.sent_at ? "emailed" : "not emailed"}) — make sure this is a different payment.`);
      }
    }

    let items: ReceiptItem[] | null = null;
    if (!isBlank(v.items)) {
      const r = receiptLines(v.items);
      if (r.problem) problems.push({ field: "items", message: r.problem });
      else items = r.items;
    } else if (lead) {
      items = prefillItems(lead).filter((i) => i.rate > 0);
      if (!items.length) {
        items = null;
        problems.push({ field: "items", message: `${lead.business_name} has no quoted price to put on the receipt — what did the client pay for, and how much?` });
      }
    } else if (stepLead) {
      problems.push({ field: "items", message: "Say what the client paid for and how much (the lead is only created in an earlier step)." });
    }

    if (items) {
      values.items = items;
      const t = computeTotals(items, num(v.discount), num(v.tax_rate));
      if (t.total <= 0) problems.push({ field: "items", message: "The total paid must be more than $0." });
      const paidOn = typeof v.paid_on === "string" ? v.paid_on : todayYmd(ctx.timezone, ctx.now);
      const suggested = suggestNotes(items, paidOn).join("\n");
      if (isBlank(v.notes) || (typeof v.notes_suggested === "string" && v.notes === v.notes_suggested)) {
        values.notes = suggested;
        values.notes_suggested = suggested;
      }
    }
    if (isStepRef(v.lead) && isBlank(v.bill_to_business)) problems.push({ field: "bill_to_business", message: "Say the business name for the receipt." });

    const notes = lines(values.notes ?? v.notes);
    if (notes.length > 10) problems.push({ field: "notes", message: "At most 10 notes (one per line)." });
    else if (notes.some((l) => l.length > 300)) problems.push({ field: "notes", message: "Each note must be under 300 characters." });
    if (typeof v.paid_on === "string" && v.paid_on > todayYmd(ctx.timezone, ctx.now)) warnings.push("The paid date is in the future.");
    const billEmail = str(values.bill_to_email ?? v.bill_to_email);
    if (billEmail) warnings.push(...(await recipientWarnings("bill_to_email", billEmail)));
    return { problems, warnings, values };
  },
  async preview(v, ctx) {
    const items = Array.isArray(v.items) ? (v.items as ReceiptItem[]) : [];
    const t = computeTotals(items, num(v.discount), num(v.tax_rate));
    const services = items.map((i, n) =>
      row(`item_${n + 1}`, `Service ${n + 1}`, `${itemDisplayTitle(i)} — ${i.qty > 1 ? `${i.qty} × ${formatMoney(i.rate)} = ` : ""}${formatMoney(lineAmount(i))}`),
    );
    const signer = await receiptSigner(ctx);
    return {
      title: `Receipt for ${str(v.bill_to_business || v.__name)} — ${formatMoney(t.total)} paid via ${str(v.payment_method)}`,
      fields: await cardRows(receiptCreate, v, ctx, { first: [...services, row("total", "Total paid", totalsLine(t))] }),
      notes: [
        "Nothing is sent yet: email it to the client afterwards (receipt.send, or from the lead page).",
        "A receipt is a permanent numbered record — it cannot be undone or deleted (a correction is a new receipt).",
        signer ? `Signed by ${signer} (Receipt settings).` : "The signature line stays blank (no signer is set in Receipt settings).",
      ],
      link: isStepRef(v.lead) ? null : leadLink(str(v.lead)),
    };
  },
  async execute(v) {
    const items = Array.isArray(v.items) ? (v.items as ReceiptItem[]) : [];
    const t = computeTotals(items, num(v.discount), num(v.tax_rate));
    const lead = str(v.lead);
    const res = await callRoute<{ receipt: { id: string; receipt_no: string; total: number | string } }>(receiptsRoute, "POST", {
      path: `/api/leads/${lead}/receipts`,
      params: { id: lead },
      // The form's own payload; the endpoint recomputes the totals itself.
      body: {
        bill_to_name: str(v.bill_to_name),
        bill_to_business: str(v.bill_to_business),
        bill_to_email: str(v.bill_to_email),
        bill_to_phone: str(v.bill_to_phone) || null,
        project_title: str(v.project_title) || DEFAULT_PROJECT_TITLE,
        items,
        discount: t.discount,
        tax_rate: t.taxRate,
        paid_on: v.paid_on,
        payment_method: v.payment_method,
        payment_reference: str(v.payment_reference) || null,
        notes: lines(v.notes),
      },
    });
    const r = res.receipt;
    return {
      message: `Created receipt ${r.receipt_no} for ${str(v.bill_to_business)} — ${formatMoney(Number(r.total))} paid. It has not been emailed yet.`,
      link: leadLink(lead),
      data: { id: r.id, kind: "receipt", receipt_no: r.receipt_no, lead_id: lead },
    };
  },
  // No undo: the app has no way to delete an issued receipt, by design.
};

/* ---------------------------------------------------------- receipt.send */

interface ReceiptBrief {
  id: string;
  receipt_no: string;
  total: number | string;
  lead_id: string;
  bill_to_business: string;
  bill_to_email: string | null;
  sent_to: string | null;
  sent_at: string | null;
}

const receiptSend: ActionDef = {
  key: "receipt.send",
  group: "Money",
  title: "Email a receipt",
  description:
    "Email an issued receipt's PDF to the client from the billing mailbox — the receipt's Email button. The address defaults to where it was last sent, else the receipt's bill-to email; give another only when the person says so. Sending again is allowed (the client asked for it again).",
  confirmLabel: "Email receipt",
  risk: "sensitive",
  allowed: (ctx) => need(ctx, "receipts.send"),
  fields: [
    { name: "receipt", label: "Receipt", type: "ref", ref: "receipt", required: true, editable: false, help: "The receipt number (SED-…) or the client's business name." },
    { name: "to", label: "To", type: "email", help: "Who receives it (default: where it was last sent, else the bill-to email)." },
  ],
  label: (v) => str(v.__no),
  minutesSaved: 2,
  async check(v, ctx): Promise<CheckResult> {
    const problems: Problem[] = [];
    const warnings: string[] = [];
    const values: Values = {};
    const sender = await receiptSender(ctx);
    if (!sender) problems.push({ field: "_", message: `No billing mailbox is linked, so receipts cannot be emailed. An admin can link ${BILLING_MAILBOX_ADDRESS} in Admin → Mail.` });
    else values.__from = sender;
    // A receipt made by an earlier plan step is read when this step runs.
    if (typeof v.receipt !== "string" || isStepRef(v.receipt)) return { problems, warnings, values };

    const { data } = await ctx.admin
      .from("lead_receipts")
      .select("id, receipt_no, total, lead_id, bill_to_business, bill_to_email, sent_to, sent_at")
      .eq("id", v.receipt)
      .maybeSingle();
    const r = data as ReceiptBrief | null;
    if (!r) return { problems: [...problems, { field: "receipt", message: "That receipt no longer exists." }], warnings, values };
    Object.assign(values, { __no: r.receipt_no, __business: r.bill_to_business, __lead: r.lead_id, __total: Number(r.total) });
    if (isBlank(v.to)) {
      const to = str(r.sent_to || r.bill_to_email).trim().toLowerCase();
      if (EMAIL_RE.test(to)) values.to = to;
      else problems.push({ field: "to", message: `Receipt ${r.receipt_no} has no email address — who should it go to?` });
    }
    const to = str(values.to ?? v.to);
    if (to) warnings.push(...(await recipientWarnings("to", to)));
    if (r.sent_at) warnings.push(`It was already emailed to ${r.sent_to} on ${formatShortDate(r.sent_at)} — this sends it again.`);
    return { problems, warnings, values };
  },
  async preview(v, ctx) {
    const extra: CardField[] = [row("from", "From", str(v.__from))];
    if (typeof v.__total === "number") extra.push(row("total", "Amount", formatMoney(v.__total)));
    return {
      title: v.__no ? `Email receipt ${str(v.__no)} to ${str(v.to)}` : `Email the receipt from the earlier step to ${str(v.to) || "its bill-to email"}`,
      fields: await cardRows(receiptSend, v, ctx, { last: extra }),
      notes: [`The client gets the receipt PDF by email${v.__from ? ` from ${str(v.__from)}` : ""}.`, "An email cannot be unsent — there is no undo."],
      link: v.__lead ? leadLink(str(v.__lead)) : null,
    };
  },
  async execute(v) {
    const id = str(v.receipt);
    const res = await callRoute<{ receipt?: { receipt_no?: string; lead_id?: string } }>(receiptSendRoute, "POST", {
      path: `/api/receipts/${id}/send`,
      params: { id },
      body: { to: v.to },
    });
    const lead = res.receipt?.lead_id ?? str(v.__lead);
    return {
      message: `Emailed receipt ${res.receipt?.receipt_no ?? str(v.__no)} to ${str(v.to)}.`,
      link: lead ? leadLink(lead) : null,
      data: { id, kind: "receipt" },
    };
  },
};

/* ---------------------------------------------------------- contract.draft */

/** The built-in template, as the contract screen labels it. */
const BUILTIN_TEMPLATE = `${CONTRACT_TEMPLATES[0].label} (built in)`;
/** The contract screen's default cover message. */
const DEFAULT_COVER_MESSAGE = "Hi,\n\nPlease find your website services agreement attached. Let me know if you have any questions.\n\nThank you.";

/** Google Doc templates, as the contract screen lists them (GET /api/contract-templates reads them the same way). */
async function googleTemplates(ctx: ActionContext): Promise<{ id: string; name: string }[]> {
  const { data } = await ctx.admin.from("contract_templates").select("id, name").order("name", { ascending: true });
  return (data ?? []) as { id: string; name: string }[];
}

const contractDraft: ActionDef = {
  key: "contract.draft",
  group: "Money",
  title: "Draft a contract",
  description:
    "Create a lead's contract (Website Development Agreement) as a DRAFT with its PDF — the lead page's New contract → Create & preview. Prices start from the lead's quoted one-time and yearly prices (give others only for a discount or price the person states); it will be sent from the person's own mailbox unless they name another; the template and cover message have defaults. The lead must have an email address. Nothing is emailed: send it with contract.send (in a plan: contract \"@1\").",
  confirmLabel: "Create draft",
  risk: "standard",
  allowed: (ctx) => need(ctx, "contracts.send"),
  fields: [
    { name: "lead", label: "Lead", type: "ref", ref: "lead", required: true, editable: false },
    {
      name: "one_time_price",
      label: "One-time price",
      type: "money",
      help: "Default: the lead's quoted price. Give another amount only when the person states a discount or a different price.",
    },
    { name: "yearly_price", label: "Yearly price", type: "money", help: "Default: the lead's yearly price. 0 = no yearly fee." },
    {
      name: "mailbox",
      label: "Send from",
      type: "enum",
      options: async (ctx) => (await verifiedMailboxes(ctx)).map((m) => m.email_address),
      help: "The company mailbox the contract is emailed from when it is sent (default: the person's own).",
    },
    {
      name: "template",
      label: "Template",
      type: "enum",
      options: async (ctx) => [...(await googleTemplates(ctx)).map((t) => t.name), BUILTIN_TEMPLATE],
      help: "Default: the first Google Doc template if there are any (as the contract screen picks), else the built-in agreement.",
    },
    { name: "message_body", label: "Cover message", type: "longtext", max: 5000, default: DEFAULT_COVER_MESSAGE, help: "The email text sent with the contract (default: a short standard note)." },
  ],
  label: (v) => str(v.__name),
  produces: "contract",
  minutesSaved: 4,
  async check(v, ctx): Promise<CheckResult> {
    const problems: Problem[] = [];
    const warnings: string[] = [];
    const values: Values = {};
    const stepLead = isStepRef(v.lead);
    const lead = stepLead ? null : await visibleLead<Lead>(ctx, v.lead);
    if (typeof v.lead === "string" && !stepLead && !lead) problems.push({ field: "lead", message: "That lead is not visible to you." });

    if (lead) {
      values.__name = lead.business_name;
      const email = str(lead.business_email).trim();
      values.__email = email;
      // The endpoint's own gate: business name, email and a one-time price.
      if (!email) problems.push({ field: "lead", message: `${lead.business_name} has no email address — add it to the lead first (the contract is addressed to it).` });
      else warnings.push(...(await recipientWarnings("lead", email)));
      if (v.one_time_price === undefined) {
        const p = parsePrice(lead.price_quoted);
        if (p === null) problems.push({ field: "one_time_price", message: `${lead.business_name} has no quoted price — what is the one-time price?` });
        else values.one_time_price = p;
      }
      if (v.yearly_price === undefined) {
        const y = parsePrice(lead.yearly_price);
        if (y !== null) values.yearly_price = y;
      }
      const { data: earlier } = await ctx.admin
        .from("contracts")
        .select("status, created_at, sent_at, recipient_email")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false })
        .limit(3);
      for (const c of (earlier ?? []) as { status: string; created_at: string; sent_at: string | null; recipient_email: string | null }[]) {
        warnings.push(
          c.status === "sent"
            ? `A contract was already sent to ${c.recipient_email ?? "the client"} on ${formatShortDate(c.sent_at ?? c.created_at)}.`
            : `There is already an unsent draft from ${formatShortDate(c.created_at)} — this makes another.`,
        );
      }
    }
    if (typeof v.one_time_price === "number" && parsePrice(v.one_time_price) === null) {
      problems.push({ field: "one_time_price", message: "The one-time price must be more than $0." });
    }

    // Any verified mailbox may send a contract (the composer offers them all);
    // the person's own is the default.
    const boxes = await verifiedMailboxes(ctx);
    if (typeof v.mailbox === "string") {
      const hit = boxes.find((m) => m.email_address === v.mailbox);
      if (hit) values.__mailbox_id = hit.id;
      else problems.push({ field: "mailbox", message: `${v.mailbox} is not a verified mailbox any more — pick another.` });
    } else {
      const mine = boxes.filter((m) => m.user_id === ctx.userId).sort((a, b) => str(a.created_at).localeCompare(str(b.created_at)))[0];
      if (mine) {
        values.mailbox = mine.email_address;
        values.__mailbox_id = mine.id;
      } else if (!boxes.length) {
        problems.push({ field: "_", message: "There is no verified company mailbox to send contracts from. An admin can link one in Admin → Mail." });
      } else {
        problems.push({ field: "mailbox", message: "Which mailbox should the contract be sent from?", choices: boxes.slice(0, 8).map((m) => m.email_address) });
      }
    }

    const templates = await googleTemplates(ctx);
    if (typeof v.template === "string") values.__template_id = templates.find((t) => t.name === v.template)?.id ?? null;
    else {
      values.template = templates[0]?.name ?? BUILTIN_TEMPLATE;
      values.__template_id = templates[0]?.id ?? null;
    }
    return { problems, warnings, values };
  },
  async preview(v, ctx) {
    const lead = await visibleLead<Lead>(ctx, v.lead);
    const one = typeof v.one_time_price === "number" ? v.one_time_price : null;
    const yearly = parsePrice(typeof v.yearly_price === "number" ? v.yearly_price : null);
    const notes = [
      "Nothing is emailed yet: this creates the contract and its PDF for review. Send it with contract.send, or from the lead page.",
      `It is addressed to ${str(v.__email) || "the lead's email"} and records the lead's business name, phone and email as they are now.`,
    ];
    if (lead) {
      const was = parsePrice(lead.price_quoted);
      if (was !== null && one !== null && was !== one) notes.push(`One-time price ${one < was ? "discounted" : "raised"} from the lead's ${formatUsd(was)}.`);
      const wasYearly = parsePrice(lead.yearly_price);
      if (wasYearly !== null && yearly === null) notes.push(`No yearly fee (the lead has ${formatUsd(wasYearly)} a year).`);
    }
    return {
      title: `Contract for ${str(v.__name) || "the lead"} — ${formatUsd(one)} one-time${yearly !== null ? ` + ${formatUsd(yearly)} / year` : ""}`,
      fields: await cardRows(contractDraft, v, ctx, { last: [row("to", "Addressed to", str(v.__email))] }),
      notes,
      link: isStepRef(v.lead) ? null : leadLink(str(v.lead)),
    };
  },
  async execute(v, ctx) {
    // check() worked these out moments ago; looked up again if it could not run.
    const mailboxId = typeof v.__mailbox_id === "string" ? v.__mailbox_id : (await verifiedMailboxes(ctx)).find((m) => m.email_address === v.mailbox)?.id;
    const templateId =
      v.__template_id !== undefined ? (v.__template_id as string | null) : ((await googleTemplates(ctx)).find((t) => t.name === v.template)?.id ?? null);
    let res: { contract: { id: string } };
    try {
      res = await callRoute<{ contract: { id: string } }>(contractsRoute, "POST", {
        path: "/api/contracts",
        // The composer's own payload: prices are always sent, so an agent's
        // discount (or a cleared yearly fee) wins over the lead's.
        body: {
          lead_id: v.lead,
          mailbox_id: mailboxId,
          template_key: DEFAULT_TEMPLATE_KEY,
          google_template_id: templateId,
          message_body: str(v.message_body),
          one_time_price: typeof v.one_time_price === "number" ? v.one_time_price : undefined,
          yearly_price: typeof v.yearly_price === "number" ? v.yearly_price : null,
        },
      });
    } catch (e) {
      // The endpoint lists what the lead is missing beside its error.
      const missing = e instanceof RouteError ? (e.body as { missing?: unknown } | null)?.missing : null;
      if (e instanceof RouteError && Array.isArray(missing)) throw new RouteError(`${e.message}: ${missing.join(", ")}.`, e.status, e.body);
      throw e;
    }
    const id = res.contract.id;
    return {
      message: `Drafted the contract for ${str(v.__name)} (${formatUsd(typeof v.one_time_price === "number" ? v.one_time_price : null)} one-time). Review the PDF, then send it.`,
      link: { href: `/api/contracts/${id}/pdf`, label: "Review the PDF" },
      data: { id, kind: "contract", lead_id: v.lead },
    };
  },
  // No undo: the app has no way to delete a contract. A draft reaches no one
  // until it is sent.
};

/* ---------------------------------------------------------- contract.send */

interface ContractBrief {
  id: string;
  lead_id: string;
  business_name: string;
  status: "draft" | "sent";
  recipient_email: string | null;
  mailbox_id: string | null;
  one_time_price: number | null;
  yearly_price: number | null;
  sent_at: string | null;
}

const contractSend: ActionDef = {
  key: "contract.send",
  group: "Money",
  title: "Send a contract",
  description:
    "Email a DRAFT contract's PDF to the client (the address on the contract) from the mailbox picked when it was drafted — the composer's Send contract. A contract that was already sent cannot be sent again: draft a new one.",
  confirmLabel: "Send contract",
  risk: "sensitive",
  allowed: (ctx) => need(ctx, "contracts.send"),
  fields: [{ name: "contract", label: "Contract", type: "ref", ref: "contract", required: true, editable: false, help: "The contract, by the client's business name." }],
  label: (v) => str(v.__name),
  minutesSaved: 2,
  async check(v, ctx): Promise<CheckResult> {
    if (typeof v.contract !== "string" || isStepRef(v.contract)) return {};
    const { data } = await ctx.admin
      .from("contracts")
      .select("id, lead_id, business_name, status, recipient_email, mailbox_id, one_time_price, yearly_price, sent_at")
      .eq("id", v.contract)
      .maybeSingle();
    const c = data as ContractBrief | null;
    if (!c) return { problems: [{ field: "contract", message: "That contract no longer exists." }] };
    const problems: Problem[] = [];
    const warnings: string[] = [];
    const values: Values = { __name: c.business_name, __to: c.recipient_email ?? "", __lead: c.lead_id, __one: c.one_time_price, __yearly: c.yearly_price };
    // The endpoint's own refusals, said before confirming.
    if (c.status === "sent") problems.push({ field: "contract", message: `That contract was already sent${c.sent_at ? ` on ${formatShortDate(c.sent_at)}` : ""} — to send it again, draft a new one.` });
    if (!c.recipient_email) problems.push({ field: "contract", message: "This contract has no recipient email." });
    else warnings.push(...(await recipientWarnings("contract", c.recipient_email)));
    if (!c.mailbox_id) problems.push({ field: "contract", message: "This contract has no sending mailbox." });
    else {
      const { data: m } = await ctx.admin.from("company_mailboxes").select("email_address, display_name").eq("id", c.mailbox_id).maybeSingle();
      if (!m) problems.push({ field: "contract", message: "The contract's sending mailbox no longer exists." });
      else values.__from = mailboxLabel(m as { email_address: string; display_name: string | null });
    }
    return { problems, warnings, values };
  },
  async preview(v, ctx) {
    const step = isStepRef(v.contract);
    const one = v.__one === undefined ? null : parsePrice(v.__one as number | null);
    const yearly = v.__yearly === undefined ? null : parsePrice(v.__yearly as number | null);
    const extra: CardField[] = step
      ? []
      : [
          row("to", "To", str(v.__to)),
          row("from", "From", str(v.__from)),
          row("price", "Price", `${formatUsd(one)} one-time${yearly !== null ? ` + ${formatUsd(yearly)} / year` : ""}`),
        ];
    return {
      title: step ? "Send the contract drafted in the earlier step" : `Send the contract to ${str(v.__to)} — ${str(v.__name)}`,
      fields: await cardRows(contractSend, v, ctx, { last: extra }),
      notes: [
        `The client gets the contract PDF by email${v.__from ? ` from ${str(v.__from)}` : ""}.`,
        "The lead's team is notified that it went out.",
        "An email cannot be unsent — there is no undo.",
      ],
      link: step ? null : { href: `/api/contracts/${str(v.contract)}/pdf`, label: "Review the PDF first" },
    };
  },
  async execute(v) {
    const id = str(v.contract);
    const res = await callRoute<{ contract?: { recipient_email?: string | null; business_name?: string; lead_id?: string } }>(contractSendRoute, "POST", {
      path: `/api/contracts/${id}/send`,
      params: { id },
    });
    const to = res.contract?.recipient_email ?? str(v.__to);
    const lead = res.contract?.lead_id ?? str(v.__lead);
    return {
      message: `Sent the contract for ${res.contract?.business_name ?? str(v.__name)} to ${to}.`,
      link: lead ? leadLink(lead) : null,
      data: { id, kind: "contract" },
    };
  },
};

export const MONEY_ACTIONS: ActionDef[] = [receiptCreate, receiptSend, contractDraft, contractSend];
