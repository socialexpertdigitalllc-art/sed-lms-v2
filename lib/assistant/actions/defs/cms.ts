import type { z } from "zod";
import { couponSchema, offerSchema, portfolioSchema, serviceSchema, testimonialSchema } from "@/lib/website-cms/schema";
import { WEBSITE_LEAD_STATUSES, type WebsiteCouponRow, type WebsiteLeadRow, type WebsiteLeadStatus } from "@/lib/website-cms/types";
import { localDateKey } from "../../dates";
import { attachmentUrl } from "../../uploads";
import type { CardChange } from "../card";
import { formatDate, isBlank, parseDateTime, UPLOAD_PREFIX } from "../fields";
import { displayValue, isStepRef, movedOn, need, str } from "../helpers";
import { callRoute, RouteError } from "../invoke";
import { isUuid, likeTerm, looksLikeUuid } from "../refs";
import type { ActionContext, ActionDef, CheckResult, FieldSpec, Problem, Values } from "../types";
import { cardRows } from "./email";

/**
 * Agency website actions (socialexpertdigitalllc.com is rendered from the
 * Website CMS): work an inbound website enquiry, manage coupons, and add or
 * edit offers, testimonials, portfolio entries and service pages. Every one
 * runs through the CMS's own endpoints (website.manage), so the activity log
 * and the live-site refresh happen exactly as when saving on the Website
 * screens.
 *
 * One action per kind of content rather than one with a `kind` switch: the
 * four share nothing but "create or update", and a focused field list is
 * what keeps the model from mixing a testimonial's fields into an offer.
 *
 * FULL ROWS. The CMS's PUT validates the whole row (the editors always send
 * every field), so an edit is the current row with the given fields changed,
 * checked here against the endpoint's own schema before it is proposed.
 */

const websiteLeadRoute = () => import("@/app/api/website/leads/[id]/route");
const collectionRoute = () => import("@/app/api/website/[collection]/route");
const collectionRowRoute = () => import("@/app/api/website/[collection]/[id]/route");

type Row = Record<string, unknown>;
type Publish = { ok: true; tags: string[] } | { ok: false; error: string } | null | undefined;

const NONE = "none";
const clip = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const linesOf = (x: unknown): string[] =>
  str(x)
    .split("\n")
    .map((l) => l.replace(/^\s*[-•*]\s*/, "").trim())
    .filter(Boolean);

/** What the save did to the live site, for the result message. */
function published(p: Publish): string {
  if (!p) return "";
  return p.ok ? " The live site is updating now." : ` The live site was not told (${p.error}); it catches up within 5 minutes.`;
}

async function createIn(collection: string, body: Row) {
  return callRoute<{ id: string; publish?: Publish }>(collectionRoute, "POST", { path: `/api/website/${collection}`, params: { collection }, body });
}
async function saveIn(collection: string, id: string, body: Row) {
  return callRoute<{ ok: true; publish?: Publish }>(collectionRowRoute, "PUT", { path: `/api/website/${collection}/${id}`, params: { collection, id }, body });
}
async function deleteIn(collection: string, id: string) {
  return callRoute<{ ok: true; publish?: Publish }>(collectionRowRoute, "DELETE", { path: `/api/website/${collection}/${id}`, params: { collection, id } });
}

/** The endpoint's own schema on the exact row it will receive: each failure as a problem on the field it is about. */
function schemaProblems(schema: z.ZodType, payload: unknown, labels: Record<string, string>, fieldOf: (key: string) => string = (k) => k): Problem[] {
  const r = schema.safeParse(payload);
  if (r.success) return [];
  const out: Problem[] = [];
  for (const issue of r.error.issues) {
    const key = String(issue.path[0] ?? "");
    const field = key ? fieldOf(key) : "_";
    if (out.some((p) => p.field === field)) continue;
    const where = issue.path.length > 1 ? ` (${issue.path.slice(1).map(String).join(" › ")})` : "";
    out.push({ field, message: `${labels[key] ?? key}${where}: ${issue.message}` });
  }
  return out;
}

/** Service page slugs, as the Coupons and Offers screens list them. */
async function serviceSlugs(ctx: ActionContext): Promise<string[]> {
  const { data } = await ctx.admin.from("website_services").select("slug").order("sort_order", { ascending: true });
  return ((data ?? []) as { slug: string }[]).map((s) => s.slug);
}

/* -------------------------------------------------------------- cms.lead */

const LEAD_STATUS_LABEL: Record<WebsiteLeadStatus, string> = { new: "New", contacted: "Contacted", qualified: "Qualified", won: "Won", lost: "Lost" };
const statusLabel = (s: unknown) => LEAD_STATUS_LABEL[s as WebsiteLeadStatus] ?? str(s);
const LEADS_LINK = { href: "/website/leads", label: "Open website leads" };

type WebLead = Pick<WebsiteLeadRow, "id" | "name" | "email" | "status" | "notes" | "is_spam" | "spam_reason" | "contacted_at" | "assigned_to" | "updated_at">;

async function webLead(ctx: ActionContext, id: unknown): Promise<WebLead | null> {
  if (typeof id !== "string" || isStepRef(id)) return null;
  const { data } = await ctx.admin
    .from("website_leads")
    .select("id, name, email, status, notes, is_spam, spam_reason, contacted_at, assigned_to, updated_at")
    .eq("id", id)
    .maybeSingle();
  return (data as WebLead | null) ?? null;
}

const withNote = (notes: string, add: string) => (notes.trim() ? `${notes.trimEnd()}\n${add}` : add);

const cmsLead: ActionDef = {
  key: "cms.lead",
  group: "Agency website",
  title: "Update a website enquiry",
  description:
    "Work an enquiry from the agency website (Website → Leads): set its status (new, contacted, qualified, won, lost), add a note, rewrite the notes, or mark it spam / not spam. The first time it leaves New the app stamps it as contacted and assigns it to the person; assigning it to someone else is not possible here.",
  confirmLabel: "Save",
  risk: "standard",
  allowed: (ctx) => need(ctx, "website.manage"),
  fields: [
    { name: "lead", label: "Enquiry", type: "ref", ref: "website_lead", required: true, editable: false, help: "Who sent it: their name or email." },
    { name: "status", label: "Status", type: "enum", options: WEBSITE_LEAD_STATUSES },
    { name: "add_note", label: "Add note", type: "longtext", max: 2000, help: "A note to add under the existing notes (what happened, the next step)." },
    { name: "replace_notes", label: "Replace notes", type: "longtext", max: 10_000, help: "Only when the person asks to rewrite ALL the notes: the new full text." },
    { name: "is_spam", label: "Spam", type: "boolean", help: "true to mark it as spam, false to mark it as not spam." },
  ],
  label: (v) => str(v.__name),
  minutesSaved: 1,
  async check(v, ctx): Promise<CheckResult> {
    const problems: Problem[] = [];
    if (v.status === undefined && v.add_note === undefined && v.replace_notes === undefined && v.is_spam === undefined) {
      problems.push({ field: "_", message: "Say what to change: the status, a note, or spam." });
    }
    if (v.add_note !== undefined && v.replace_notes !== undefined) problems.push({ field: "replace_notes", message: "Either add a note or replace the notes — not both." });
    const lead = await webLead(ctx, v.lead);
    if (typeof v.lead === "string" && !isStepRef(v.lead) && !lead) problems.push({ field: "lead", message: "That enquiry no longer exists." });
    if (lead) {
      if (v.status !== undefined && v.status === lead.status) problems.push({ field: "status", message: `It is already ${statusLabel(lead.status)}.` });
      if (v.is_spam !== undefined && v.is_spam === lead.is_spam) problems.push({ field: "is_spam", message: lead.is_spam ? "It is already marked as spam." : "It is not marked as spam." });
      if (typeof v.add_note === "string" && withNote(lead.notes ?? "", v.add_note).length > 10_000) {
        problems.push({ field: "add_note", message: "The notes would be longer than 10,000 characters." });
      }
    }
    return { problems, values: lead ? { __name: lead.name } : {} };
  },
  async preview(v, ctx) {
    const lead = await webLead(ctx, v.lead);
    const changes: CardChange[] = [];
    const notes: string[] = [];
    if (lead) {
      if (v.status !== undefined) changes.push({ label: "Status", from: statusLabel(lead.status), to: statusLabel(v.status) });
      if (typeof v.add_note === "string") changes.push({ label: "Notes", from: clip(lead.notes ?? "") || "—", to: `…${clip(v.add_note)}` });
      if (typeof v.replace_notes === "string") changes.push({ label: "Notes", from: clip(lead.notes ?? "") || "—", to: clip(v.replace_notes) });
      if (typeof v.is_spam === "boolean") changes.push({ label: "Spam", from: lead.is_spam ? "Yes" : "No", to: v.is_spam ? "Yes" : "No" });
      if (typeof v.status === "string" && v.status !== "new" && !lead.contacted_at) notes.push("This is the first time it leaves New, so it is stamped as contacted now and assigned to you.");
      if (v.is_spam === true) notes.push("It moves to the Spam tab.");
    }
    return {
      title: lead && v.status !== undefined ? `${lead.name}: ${statusLabel(lead.status)} → ${statusLabel(v.status)}` : `Update website enquiry — ${lead?.name ?? ""}`,
      fields: [],
      changes,
      notes,
      link: LEADS_LINK,
      before: lead,
    };
  },
  async stale(before, v, ctx) {
    return movedOn(before, await webLead(ctx, v.lead));
  },
  async execute(v, ctx) {
    const id = str(v.lead);
    const now = await webLead(ctx, id);
    const body: Row = {};
    if (v.status !== undefined) body.status = v.status;
    if (typeof v.replace_notes === "string") body.notes = v.replace_notes;
    else if (typeof v.add_note === "string") body.notes = withNote(now?.notes ?? "", v.add_note);
    if (typeof v.is_spam === "boolean") body.is_spam = v.is_spam;
    await callRoute(websiteLeadRoute, "PATCH", { path: `/api/website/leads/${id}`, params: { id }, body });
    // Whether the endpoint stamped first contact (and its owner) — undo puts that back too.
    const after = await webLead(ctx, id);
    const stamped = Boolean(now && !now.contacted_at && after?.contacted_at);
    const name = now?.name ?? str(v.__name);
    return {
      message: v.status !== undefined ? `${name} is now ${statusLabel(v.status)}.` : `Updated the website enquiry from ${name}.`,
      link: LEADS_LINK,
      data: { id, fields: Object.keys(body), stamped },
    };
  },
  undo: {
    async run(stored, ctx) {
      const before = (stored.before_state ?? {}) as Partial<WebLead>;
      const id = str(stored.input.lead);
      const changed = (stored.result?.data?.fields as string[] | undefined) ?? [];
      const body: Row = {};
      if (changed.includes("status") && before.status) body.status = before.status;
      if (changed.includes("notes")) body.notes = before.notes ?? "";
      if (changed.includes("is_spam") && typeof before.is_spam === "boolean") body.is_spam = before.is_spam;
      if (Object.keys(body).length) await callRoute(websiteLeadRoute, "PATCH", { path: `/api/website/leads/${id}`, params: { id }, body });
      // What the endpoint stamps by itself — first contact and its owner, the
      // spam reason — it has no field for, so those are put back directly.
      const restore: Row = {};
      if (stored.result?.data?.stamped === true) {
        restore.contacted_at = before.contacted_at ?? null;
        restore.assigned_to = before.assigned_to ?? null;
      }
      if (changed.includes("is_spam")) restore.spam_reason = before.spam_reason ?? null;
      if (Object.keys(restore).length) await ctx.admin.from("website_leads").update(restore).eq("id", id);
      return "the enquiry is as it was.";
    },
  },
};

/* ------------------------------------------------------------ cms.coupon */

const COUPON_OPS = ["Create", "Update", "Deactivate"] as const;
const ALL_SERVICES = "all services";
const COUPONS_LINK = { href: "/website/coupons", label: "Open coupons" };
const COUPON_EDITS = ["code", "label", "discount_type", "amount", "service_slugs", "active", "expires_on", "never_expires"];
const COUPON_LABELS: Record<string, string> = {
  code: "Code",
  label: "Label",
  discount_type: "Type",
  amount: "Amount",
  service_slugs: "Limited to",
  active: "Active",
  expires_at: "Last day",
};

async function couponRow(ctx: ActionContext, id: unknown): Promise<WebsiteCouponRow | null> {
  if (typeof id !== "string" || isStepRef(id)) return null;
  const { data } = await ctx.admin.from("website_coupons").select("*").eq("id", id).maybeSingle();
  return (data as WebsiteCouponRow | null) ?? null;
}

/** "Valid through the end of that day" (the coupon screen's rule), in company time. */
function endOfDay(ymd: string, tz: string): string | null {
  return parseDateTime(`${ymd}T23:59:59`, tz)?.toISOString() ?? null;
}

/** The full row the endpoint receives: the coupon as it is (or a new one), with what was said changed. */
function couponPayload(v: Values, row: WebsiteCouponRow | null, tz: string): Row {
  const out: Row = row
    ? {
        code: row.code,
        label: row.label,
        discount_type: row.discount_type,
        amount: Number(row.amount),
        service_slugs: row.service_slugs ?? [],
        active: row.active,
        expires_at: row.expires_at,
      }
    : { label: "", discount_type: "percent", service_slugs: [], active: true, expires_at: null };
  if (v.operation === "Deactivate") return { ...out, active: false };
  if (typeof v.code === "string") out.code = v.code.toUpperCase();
  if (v.label !== undefined) out.label = v.label;
  if (v.discount_type !== undefined) out.discount_type = v.discount_type;
  if (v.amount !== undefined) out.amount = v.amount;
  if (Array.isArray(v.service_slugs)) out.service_slugs = (v.service_slugs as string[]).filter((s) => s !== ALL_SERVICES);
  if (typeof v.active === "boolean") out.active = v.active;
  if (typeof v.expires_on === "string") out.expires_at = endOfDay(v.expires_on, tz);
  if (v.never_expires === true) out.expires_at = null;
  return out;
}

function couponView(p: Row, tz: string): Record<string, string> {
  const slugs = Array.isArray(p.service_slugs) ? (p.service_slugs as string[]) : [];
  return {
    code: str(p.code),
    label: str(p.label),
    discount: p.discount_type === "fixed" ? `$${str(p.amount)} off` : `${str(p.amount)}% off`,
    services: slugs.length ? slugs.join(", ") : "All services",
    active: p.active ? "Yes" : "No",
    expires: p.expires_at ? formatDate(localDateKey(str(p.expires_at), tz)) : "Never",
  };
}
const COUPON_VIEW_LABELS: Record<string, string> = { code: "Code", label: "Label", discount: "Discount", services: "Limited to", active: "Active", expires: "Last day" };

const notDeactivate = (v: Values) => v.operation !== "Deactivate";

const cmsCoupon: ActionDef = {
  key: "cms.coupon",
  group: "Agency website",
  title: "Create, change or switch off a website coupon",
  description:
    "Manage a discount code visitors type on the agency website (Website → Coupons): Create one, Update one, or Deactivate one. The website checks coupons live, so every change works at once. For a new coupon ask for the code and the amount (percent or dollars off).",
  confirmLabel: "Save coupon",
  risk: "sensitive",
  allowed: (ctx) => need(ctx, "website.manage"),
  fields: [
    { name: "operation", label: "Change", type: "enum", options: COUPON_OPS, required: true, help: "Create a new coupon, Update one, or Deactivate one (switch it off)." },
    { name: "coupon", label: "Coupon", type: "ref", ref: "coupon", required: (v) => v.operation !== "Create", showIf: (v) => v.operation !== "Create", editable: false },
    {
      name: "code",
      label: "Code",
      type: "text",
      max: 64,
      required: (v) => v.operation === "Create",
      showIf: notDeactivate,
      help: "What visitors type: letters, digits, - and _ (saved in capitals). On Update, only to rename it.",
    },
    { name: "label", label: "Label", type: "text", max: 200, showIf: notDeactivate, help: 'Shown when a visitor applies it, e.g. "20% off any website".' },
    { name: "discount_type", label: "Type", type: "enum", options: ["percent", "fixed"], showIf: notDeactivate, help: "percent = % off, fixed = dollars off (default percent)." },
    { name: "amount", label: "Amount", type: "number", min: 0, max: 1_000_000, required: (v) => v.operation === "Create", showIf: notDeactivate, help: "The percent, or the dollars, off." },
    {
      name: "service_slugs",
      label: "Limited to",
      type: "multi",
      options: async (ctx) => [ALL_SERVICES, ...(await serviceSlugs(ctx))],
      showIf: notDeactivate,
      help: `The service pages it works on (their slugs), or "${ALL_SERVICES}" (the default).`,
    },
    { name: "active", label: "Active", type: "boolean", showIf: notDeactivate, help: "Can visitors use it (default yes)?" },
    { name: "expires_on", label: "Last day", type: "date", showIf: notDeactivate, help: "The last day it works, through the end of that day (company time). Leave out for no expiry." },
    { name: "never_expires", label: "Remove expiry", type: "boolean", showIf: (v) => v.operation === "Update", help: "true to remove its expiry date." },
  ],
  label: (v) => str(v.__name),
  produces: "coupon",
  minutesSaved: 2,
  async check(v, ctx): Promise<CheckResult> {
    const problems: Problem[] = [];
    const warnings: string[] = [];
    const values: Values = {};
    const op = v.operation;
    const row = op === "Update" || op === "Deactivate" ? await couponRow(ctx, v.coupon) : null;
    if (op !== "Create" && typeof v.coupon === "string" && !isStepRef(v.coupon) && !row) problems.push({ field: "coupon", message: "That coupon no longer exists." });
    if (row) {
      values.__name = row.code;
      if (op === "Deactivate" && !row.active) problems.push({ field: "coupon", message: `${row.code} is already switched off.` });
    }
    if (op === "Update" && !COUPON_EDITS.some((f) => v[f] !== undefined)) problems.push({ field: "_", message: "Say what to change on the coupon." });
    if (Array.isArray(v.service_slugs) && v.service_slugs.includes(ALL_SERVICES) && v.service_slugs.length > 1) {
      problems.push({ field: "service_slugs", message: `Either "${ALL_SERVICES}" or a list of services — not both.` });
    }
    if (typeof v.code === "string" && op !== "Deactivate") {
      const code = v.code.toUpperCase();
      if (op === "Create") values.__name = code;
      // Codes are unique: the endpoint would refuse a second one.
      const { data } = await ctx.admin.from("website_coupons").select("id").eq("code", code);
      if (((data ?? []) as { id: string }[]).some((r) => r.id !== row?.id)) problems.push({ field: "code", message: `There is already a coupon ${code}.` });
    }
    if (op === "Create" || row) {
      const payload = couponPayload(v, row, ctx.timezone);
      for (const p of schemaProblems(couponSchema, payload, COUPON_LABELS, (k) => (k === "expires_at" ? "expires_on" : k))) {
        if (!problems.some((x) => x.field === p.field)) problems.push(p);
      }
      if (payload.discount_type === "percent" && Number(payload.amount) > 100) warnings.push(`${str(payload.amount)}% off is more than the whole price.`);
      if (payload.active && typeof payload.expires_at === "string" && Date.parse(payload.expires_at) < ctx.now.getTime()) {
        warnings.push("Its last day has already passed, so visitors cannot use it.");
      }
    }
    return { problems, warnings, values };
  },
  async preview(v, ctx) {
    if (v.operation === "Create") {
      const view = couponView(couponPayload(v, null, ctx.timezone), ctx.timezone);
      return {
        title: `New coupon ${view.code} — ${view.discount}${view.label ? ` (${view.label})` : ""}`,
        fields: await cardRows(cmsCoupon, v, ctx),
        notes: [
          view.active === "Yes" ? "Visitors can use it on socialexpertdigitalllc.com as soon as it is saved — the website checks coupons live." : "It is saved switched off.",
          `Works on: ${view.services}. Last day: ${view.expires}.`,
        ],
        link: COUPONS_LINK,
      };
    }
    const row = await couponRow(ctx, v.coupon);
    const changes: CardChange[] = [];
    if (row) {
      const was = couponView(couponPayload({}, row, ctx.timezone), ctx.timezone);
      const next = couponView(couponPayload(v, row, ctx.timezone), ctx.timezone);
      for (const [k, label] of Object.entries(COUPON_VIEW_LABELS)) if (was[k] !== next[k]) changes.push({ label, from: was[k] || "—", to: next[k] || "—" });
    }
    const name = str(v.__name) || "from the earlier step";
    return {
      title: v.operation === "Deactivate" ? `Switch off coupon ${name}` : `Edit coupon ${name}`,
      fields: [],
      changes,
      notes: [v.operation === "Deactivate" ? "Visitors who type it are told it is not valid." : "The website checks coupons live, so the change works at once."],
      link: COUPONS_LINK,
      before: row,
    };
  },
  async stale(before, v, ctx) {
    if (v.operation === "Create" || !before) return null;
    return movedOn(before, await couponRow(ctx, v.coupon));
  },
  async execute(v, ctx) {
    if (v.operation === "Create") {
      const payload = couponPayload(v, null, ctx.timezone);
      const res = await createIn("coupons", payload);
      return { message: `Created coupon ${str(payload.code)} (${couponView(payload, ctx.timezone).discount}).`, link: COUPONS_LINK, data: { id: res.id, kind: "coupon" } };
    }
    const id = str(v.coupon);
    const row = await couponRow(ctx, id);
    if (!row) throw new RouteError("That coupon no longer exists.", 404, null);
    const payload = couponPayload(v, row, ctx.timezone);
    await saveIn("coupons", id, payload);
    return {
      message: v.operation === "Deactivate" ? `Switched off coupon ${row.code}.` : `Updated coupon ${str(payload.code)}.`,
      link: COUPONS_LINK,
      data: { id, kind: "coupon" },
    };
  },
  undo: {
    async run(stored, ctx) {
      const id = str(stored.result?.data?.id);
      if (stored.input.operation === "Create") {
        await deleteIn("coupons", id);
        return "the coupon was deleted again.";
      }
      const before = stored.before_state as WebsiteCouponRow | null;
      if (!before) throw new RouteError("The coupon's previous values are unknown.", 409, null);
      await saveIn("coupons", id, couponPayload({}, before, ctx.timezone));
      return "the coupon is as it was.";
    },
  },
};

/* ------------------------------------------- offers, testimonials, portfolio, services */

interface ContentSpec {
  key: string;
  collection: "offers" | "testimonials" | "portfolio" | "services";
  table: string;
  noun: string;
  title: string;
  description: string;
  /** The endpoint's own schema for this collection. */
  schema: z.ZodType;
  /** What people call a record; the first is its display name. */
  nameColumns: string[];
  /** For the model: how to name one for an edit. */
  nameHelp: string;
  /** Telling two similar records apart in a "which one?" question. */
  choice?: (r: Row) => string;
  /** The row's fields — named exactly as the schema's keys — in card order. */
  fields: FieldSpec[];
  /** The schema's required keys (asked for only when creating). */
  requiredToCreate: string[];
  /** What a new one starts with that the editor fills in. */
  createDefaults?: (v: Values) => Row;
  /** A field's value → the row's (one-per-line lists, JSON text, "none" → null). */
  toRow?: Record<string, (x: unknown) => unknown>;
  /** How a value reads on the card where a raw value would not. */
  show?: Record<string, (x: unknown) => string>;
  /** Shown on the live site. */
  live: (r: Row) => boolean;
  notes?: (payload: Row, row: Row | null) => string[];
  extraCheck?: (payload: Row, row: Row | null, ctx: ActionContext) => Promise<{ problems?: Problem[]; warnings?: string[] }>;
  link: { href: string; label: string };
}

async function rowById(s: ContentSpec, ctx: ActionContext, id: unknown): Promise<Row | null> {
  if (!isUuid(id)) return null;
  const { data } = await ctx.admin.from(s.table).select("*").eq("id", id.trim().toLowerCase()).maybeSingle();
  return (data as Row | null) ?? null;
}

const pluralNoun = (noun: string) => (noun.endsWith("y") ? `${noun.slice(0, -1)}ies` : `${noun}s`);

const squash = (x: unknown) =>
  str(x)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The record a person means, by id or by what they call it — one clear match, or a question. */
async function findRow(s: ContentSpec, ctx: ActionContext, q: unknown): Promise<{ row: Row } | { problem: string; choices?: string[] }> {
  const text = str(q).trim();
  if (!text) return { problem: `Say which ${s.noun}.` };
  if (looksLikeUuid(text)) {
    const row = await rowById(s, ctx, text);
    return row ? { row } : { problem: `That ${s.noun} no longer exists.` };
  }
  // A pasted address is searched without its scheme (as refs.ts does for websites).
  const term = likeTerm(text.replace(/^https?:\/\//i, "").replace(/\/+$/, ""));
  const { data } = await ctx.admin
    .from(s.table)
    .select("*")
    .or(s.nameColumns.map((c) => `${c}.ilike.%${term}%`).join(","))
    .limit(8);
  const rows = (data ?? []) as Row[];
  if (!rows.length) return { problem: `No ${s.noun} called "${text}" was found.` };
  const exact = rows.filter((r) => s.nameColumns.some((c) => squash(r[c]) === squash(text)));
  const pick = exact.length === 1 ? exact[0] : rows.length === 1 ? rows[0] : null;
  if (pick) return { row: pick };
  const list = exact.length ? exact : rows;
  return {
    problem: `"${text}" matches ${list.length} ${pluralNoun(s.noun)} — which one?`,
    choices: list.slice(0, 6).map((r) => `${s.choice ? s.choice(r) : str(r[s.nameColumns[0]])} [id ${str(r.id)}]`),
  };
}

/** A chat attachment that has to live on a page becomes a public link (only when the change is made). */
async function publishable(s: ContentSpec, payload: Row, ctx: ActionContext): Promise<Row> {
  const out = { ...payload };
  for (const f of s.fields) {
    const x = out[f.name];
    if (f.type === "attachment" && typeof x === "string" && x.startsWith(UPLOAD_PREFIX)) out[f.name] = await attachmentUrl(ctx.admin, ctx.ownerId ?? ctx.userId, x);
  }
  return out;
}

function contentAction(s: ContentSpec): ActionDef {
  const keys = s.fields.map((f) => f.name);
  const labels: Record<string, string> = Object.fromEntries(s.fields.map((f) => [f.name, f.label]));
  const Noun = s.noun.charAt(0).toUpperCase() + s.noun.slice(1);
  const nameOf = (r: Row) => str(r[s.nameColumns[0]]);
  const showValue = (k: string, x: unknown) => (s.show?.[k] ? s.show[k](x) : displayValue(x));

  /** The row the endpoint receives: the record as it is (or a new one), with what was said changed. */
  const payloadOf = (v: Values, row: Row | null): Row => {
    const out: Row = row ? Object.fromEntries(keys.map((k) => [k, row[k]])) : { ...(s.createDefaults?.(v) ?? {}) };
    for (const k of keys) if (v[k] !== undefined) out[k] = s.toRow?.[k] ? s.toRow[k](v[k]) : v[k];
    return out;
  };

  const def: ActionDef = {
    key: s.key,
    group: "Agency website",
    title: s.title,
    description: s.description,
    confirmLabel: "Save & publish",
    // Content the public sees (or stops seeing) is checked more carefully.
    risk: (v) => (v.__live === true ? "sensitive" : "standard"),
    allowed: (ctx) => need(ctx, "website.manage"),
    fields: [
      { name: "operation", label: "Change", type: "enum", options: ["Create", "Update"], required: true, help: `Create a new ${s.noun}, or Update an existing one (give only what changes).` },
      { name: "item", label: Noun, type: "text", required: (v) => v.operation === "Update", showIf: (v) => v.operation === "Update", editable: false, help: `Which ${s.noun} to update: ${s.nameHelp}.` },
      // The record `item` named, pinned when proposed.
      { name: "item_id", label: "Record", type: "text", hidden: true, showIf: (v) => v.operation === "Update", help: "Internal — leave out (name it in item)." },
      ...s.fields.map((f) => (s.requiredToCreate.includes(f.name) ? { ...f, required: (v: Values) => v.operation === "Create" } : f)),
    ],
    label: (v) => str(v.__name),
    minutesSaved: 3,
    async check(v, ctx): Promise<CheckResult> {
      const problems: Problem[] = [];
      const warnings: string[] = [];
      const values: Values = {};
      let row: Row | null = null;
      if (v.operation === "Update") {
        if (!keys.some((k) => v[k] !== undefined)) problems.push({ field: "_", message: `Say what to change on the ${s.noun}.` });
        const found = await findRow(s, ctx, v.item_id ?? v.item);
        if ("row" in found) {
          row = found.row;
          values.item_id = str(row.id);
          values.__name = nameOf(row);
        } else if (!isBlank(v.item) || !isBlank(v.item_id)) {
          problems.push({ field: "item", message: found.problem, ...(found.choices ? { choices: found.choices } : {}) });
        }
      }
      if (v.operation === "Create" || row) {
        const payload = payloadOf(v, row);
        if (!row) values.__name = nameOf(payload);
        for (const p of schemaProblems(s.schema, payload, labels)) if (!problems.some((x) => x.field === p.field)) problems.push(p);
        values.__live = s.live(payload) || (row !== null && s.live(row));
        const extra = (await s.extraCheck?.(payload, row, ctx)) ?? {};
        problems.push(...(extra.problems ?? []).filter((p) => !problems.some((x) => x.field === p.field)));
        warnings.push(...(extra.warnings ?? []));
      }
      return { problems, warnings, values };
    },
    async preview(v, ctx) {
      const row = v.operation === "Update" ? await rowById(s, ctx, v.item_id) : null;
      const payload = payloadOf(v, row);
      const notes = [...(s.notes?.(payload, row) ?? [])];
      if (s.live(payload)) notes.push("It shows on socialexpertdigitalllc.com within seconds of saving.");
      else notes.push(row && s.live(row) ? "This takes it off the website." : "It is saved but not shown on the website.");
      if (!row) {
        const fields = (await cardRows(def, v, ctx)).map((f) => (s.show?.[f.name] && v[f.name] !== undefined ? { ...f, value: s.show[f.name](payload[f.name]) } : f));
        return { title: `New ${s.noun}: ${nameOf(payload)}`, fields, notes, link: s.link };
      }
      const changes: CardChange[] = [];
      for (const k of keys) {
        if (v[k] === undefined) continue;
        const from = showValue(k, row[k]);
        const to = showValue(k, payload[k]);
        if (from !== to) changes.push({ label: labels[k], from: clip(from) || "—", to: clip(to) || "—" });
      }
      return { title: `Edit ${s.noun} — ${nameOf(row)}`, fields: [], changes, notes, link: s.link, before: row };
    },
    async stale(before, v, ctx) {
      if (v.operation !== "Update") return null;
      return movedOn(before, await rowById(s, ctx, v.item_id));
    },
    async execute(v, ctx) {
      if (v.operation === "Create") {
        const payload = await publishable(s, payloadOf(v, null), ctx);
        const res = await createIn(s.collection, payload);
        return { message: `Added the ${s.noun} “${nameOf(payload)}”.${published(res.publish)}`, link: s.link, data: { id: res.id } };
      }
      const id = str(v.item_id);
      const row = await rowById(s, ctx, id);
      if (!row) throw new RouteError(`That ${s.noun} no longer exists.`, 404, null);
      const payload = await publishable(s, payloadOf(v, row), ctx);
      const res = await saveIn(s.collection, id, payload);
      return { message: `Saved the ${s.noun} “${nameOf(payload)}”.${published(res.publish)}`, link: s.link, data: { id } };
    },
    undo: {
      async run(stored) {
        const id = str(stored.result?.data?.id);
        if (stored.input.operation === "Create") {
          const res = await deleteIn(s.collection, id);
          return `the ${s.noun} was deleted again.${published(res.publish)}`;
        }
        const before = stored.before_state as Row | null;
        if (!before) throw new RouteError(`The ${s.noun}'s previous values are unknown.`, 409, null);
        const res = await saveIn(s.collection, id, Object.fromEntries(keys.map((k) => [k, before[k]])));
        return `the ${s.noun} is as it was.${published(res.publish)}`;
      },
    },
  };
  return def;
}

const sortOrder: FieldSpec = { name: "sort_order", label: "Order", type: "integer", min: 0, max: 10_000, help: "Lower comes first (default 0)." };

const parseJson = (x: unknown): unknown => {
  if (typeof x !== "string") return x;
  try {
    return JSON.parse(x);
  } catch {
    return x; // the schema says what is wrong with it
  }
};
const countOf = (noun: string) => (x: unknown) => (Array.isArray(x) ? `${x.length} ${noun}${x.length === 1 ? "" : "s"}` : displayValue(x));

const cmsOffer = contentAction({
  key: "cms.offer",
  collection: "offers",
  table: "website_offers",
  noun: "offer",
  title: "Add or edit a website offer",
  description:
    "Add or change an offer — the site-wide banner on socialexpertdigitalllc.com (Website → Offers & banner). The first active offer by order is the banner. A new offer is saved switched off unless the person says to show it now.",
  schema: offerSchema,
  nameColumns: ["title"],
  nameHelp: "its title",
  fields: [
    { name: "title", label: "Title", type: "text", max: 200, help: 'The offer\'s name, e.g. "Fall website special".' },
    { name: "banner_text", label: "Banner text", type: "text", max: 300, help: "The line shown in the site-wide banner." },
    {
      name: "service_slug",
      label: "Links to",
      type: "enum",
      options: async (ctx) => [NONE, ...(await serviceSlugs(ctx))],
      help: `The service page the banner links to (its slug), or "${NONE}".`,
    },
    { name: "active", label: "Shown on the site", type: "boolean", help: "true to show it now (a new offer starts switched off)." },
    sortOrder,
  ],
  requiredToCreate: ["title"],
  toRow: { service_slug: (x) => (x === NONE ? null : x) },
  show: { service_slug: (x) => (x ? str(x) : NONE) },
  live: (r) => r.active === true,
  link: { href: "/website/offers", label: "Open offers" },
});

const cmsTestimonial = contentAction({
  key: "cms.testimonial",
  collection: "testimonials",
  table: "website_testimonials",
  noun: "testimonial",
  title: "Add or edit a website testimonial",
  description:
    "Add or change a client testimonial on the agency website (Website → Testimonials). Only words the client really said (FTC rules): ask for the exact quote, and never write, invent or polish one. A new testimonial stays hidden until it is approved.",
  schema: testimonialSchema,
  nameColumns: ["client_name", "business"],
  nameHelp: "the client's name (or business)",
  choice: (r) => `${str(r.client_name)} — “${clip(str(r.quote), 50)}”`,
  fields: [
    { name: "client_name", label: "Client", type: "text", max: 120, help: "Who said it." },
    { name: "business", label: "Business", type: "text", max: 200 },
    { name: "quote", label: "Quote", type: "longtext", max: 2000, help: "The client's exact words, as they gave them." },
    { name: "rating", label: "Stars", type: "rating", min: 1, max: 5, help: "1–5 (default 5)." },
    { name: "approved", label: "On the website", type: "boolean", help: "true to publish it (a new testimonial stays hidden until approved)." },
    sortOrder,
  ],
  requiredToCreate: ["client_name", "quote"],
  live: (r) => r.approved === true,
  notes: () => ["Real client quotes only (FTC rules)."],
  link: { href: "/website/testimonials", label: "Open testimonials" },
});

const cmsPortfolio = contentAction({
  key: "cms.portfolio",
  collection: "portfolio",
  table: "website_portfolio",
  noun: "portfolio entry",
  title: "Add or edit a portfolio entry",
  description:
    "Add or change a client site shown in the agency website's portfolio (Website → Portfolio): the client, its live address, industry, state and an optional screenshot (a file attached in this chat, or a link).",
  schema: portfolioSchema,
  nameColumns: ["client_name", "live_url"],
  nameHelp: "the client's name or the site's address",
  fields: [
    { name: "client_name", label: "Client", type: "text", max: 200 },
    { name: "live_url", label: "Live site", type: "url", help: "The client's live website address." },
    { name: "industry", label: "Industry", type: "text", max: 120 },
    { name: "state", label: "State", type: "text", max: 60 },
    {
      name: "screenshot",
      label: "Screenshot",
      type: "attachment",
      help: "A screenshot attached in this chat, or its web address (optional — the site draws a placeholder without one).",
    },
    { name: "featured", label: "Featured on the home page", type: "boolean" },
    { name: "active", label: "Shown on the site", type: "boolean", help: "Default yes." },
    sortOrder,
  ],
  requiredToCreate: ["client_name"],
  live: (r) => r.active !== false,
  async extraCheck(payload, row, ctx) {
    const url = str(payload.live_url);
    if (!url) return {};
    const { data } = await ctx.admin.from("website_portfolio").select("id, client_name").eq("live_url", url);
    const other = ((data ?? []) as { id: string; client_name: string }[]).find((r) => r.id !== row?.id);
    return other ? { warnings: [`${url} is already in the portfolio (as ${other.client_name}).`] } : {};
  },
  link: { href: "/website/portfolio", label: "Open portfolio" },
});

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const cmsService = contentAction({
  key: "cms.service",
  collection: "services",
  table: "website_services",
  noun: "service",
  title: "Add or edit a website service page",
  description:
    "Add or change a service page on the agency website (Website → Services): name, page address (slug), tagline, description, features, pricing tiers, FAQs, pains and what's included. For an edit give only what changes; a list you give (features, tiers, FAQs…) replaces the whole list.",
  schema: serviceSchema,
  nameColumns: ["name", "slug"],
  nameHelp: "its name or slug",
  fields: [
    { name: "name", label: "Name", type: "text", max: 120 },
    { name: "slug", label: "Page address", type: "text", max: 80, help: "The page's slug — /services/<slug>: lowercase letters, digits and dashes (default: made from the name)." },
    { name: "short_name", label: "Short name", type: "text", max: 80 },
    { name: "tagline", label: "Tagline", type: "text", max: 300 },
    { name: "description", label: "Description", type: "longtext", max: 2000 },
    { name: "icon", label: "Icon", type: "text", max: 60, help: "An icon key the website knows: globe, chart, mic, phone, layout, box, headset, bug or puzzle." },
    { name: "features", label: "Features", type: "longtext", max: 20_000, help: "One feature per line (replaces the whole list)." },
    {
      name: "tiers",
      label: "Pricing tiers",
      type: "json",
      help: 'Replaces all tiers: [{"name": "Starter", "price": 499, "priceNote": "/mo" or "", "billingNote": "", "features": ["…"], "badge": "Popular" | "Recommended" (optional)}].',
    },
    { name: "quote_based", label: "Quote only", type: "boolean", help: "true when the price is by quote only." },
    { name: "starting_at", label: "Starting at", type: "text", max: 120, help: `A price teaser such as "From $499"; "${NONE}" to remove it.` },
    { name: "market_comparison", label: "Market comparison", type: "json", help: '{"label": "…", "marketPrice": "$3,000+", "ourPrice": "$549"}' },
    { name: "faqs", label: "FAQs", type: "json", help: 'Replaces all FAQs: [{"question": "…", "answer": "…"}].' },
    { name: "pain_heading", label: "Pain heading", type: "text", max: 200, help: 'The heading over the pains (default "Sound familiar?").' },
    { name: "pains", label: "Pains", type: "longtext", max: 10_000, help: "The client problems it solves, one per line (replaces the list)." },
    { name: "included", label: "What's included", type: "json", help: 'Replaces the list: [{"title": "…", "text": "…"}].' },
    sortOrder,
    { name: "active", label: "Shown on the site", type: "boolean", help: "Default yes." },
  ],
  requiredToCreate: ["name"],
  createDefaults: (v) => ({ pain_heading: "Sound familiar?", slug: slugify(str(v.name)) }),
  toRow: {
    features: linesOf,
    pains: linesOf,
    tiers: parseJson,
    market_comparison: parseJson,
    faqs: parseJson,
    included: parseJson,
    starting_at: (x) => (str(x).trim().toLowerCase() === NONE ? null : x),
  },
  show: {
    tiers: (x) =>
      Array.isArray(x) && x.length
        ? (x as Row[]).map((t) => `${str(t.name)} $${str(t.price)}${str(t.priceNote)}`).join(" · ")
        : Array.isArray(x)
          ? "none (quote-based)"
          : displayValue(x),
    faqs: countOf("question"),
    included: countOf("item"),
    market_comparison: (x) => {
      const m = (x ?? {}) as Row;
      return m && typeof m === "object" && (m.marketPrice || m.ourPrice) ? `${str(m.label)}: market ${str(m.marketPrice)}, ours ${str(m.ourPrice)}` : displayValue(x);
    },
    starting_at: (x) => (x ? str(x) : NONE),
  },
  live: (r) => r.active !== false,
  async extraCheck(payload, row, ctx) {
    const slug = str(payload.slug);
    if (!slug) return {};
    // Slugs are unique: the endpoint would refuse a second page at the same address.
    const { data } = await ctx.admin.from("website_services").select("id").eq("slug", slug);
    if (((data ?? []) as { id: string }[]).some((r) => r.id !== row?.id)) return { problems: [{ field: "slug", message: `There is already a service page at /services/${slug}.` }] };
    if (row && row.slug !== slug && row.active !== false) {
      return { warnings: [`The page moves from /services/${str(row.slug)} to /services/${slug}: links to the old address, and offers or coupons tied to "${str(row.slug)}", stop pointing at it.`] };
    }
    return {};
  },
  link: { href: "/website", label: "Open services" },
});

export const CMS_ACTIONS: ActionDef[] = [cmsLead, cmsCoupon, cmsOffer, cmsTestimonial, cmsPortfolio, cmsService];
