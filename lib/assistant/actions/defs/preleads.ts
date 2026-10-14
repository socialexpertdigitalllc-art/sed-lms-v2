import { findCollisions, type DupRow } from "@/lib/leads/duplicate";
import { FOLLOWUP_REASONS, LEAD_CATEGORIES, PRELEAD_STATUSES, SERVICE_OFFERED, SERVICE_TYPE } from "@/lib/preleads/types";
import { checkEmail, checkProfileLink, merge, profilePlatform, type CheckOutput } from "../checks";
import { formatDateTime, isBlank, money, normalizeUrl } from "../fields";
import { changesOf, displayValue, isStepRef, movedOn, need, plural, str } from "../helpers";
import { callRoute } from "../invoke";
import type { ActionContext, ActionDef, CheckResult, FieldSpec, Problem, Values } from "../types";
import { LEAD_ACTIONS, LEAD_CREATE_FIELDS } from "./leads";

/**
 * Pre-lead actions: add one, work one (follow-up or details), and turn one
 * into a full lead. Every change runs through the endpoints the Pre-leads
 * screens use (see ../invoke.ts), so their rules apply unchanged.
 */

const preLeadsRoute = () => import("@/app/api/pre-leads/route");
const preLeadRoute = () => import("@/app/api/pre-leads/[id]/route");

const preLeadLink = (id: string, label = "Open pre-lead") => ({ href: `/pre-leads/${id}`, label });
const NONE: CheckOutput = { problems: [], warnings: [], notes: [] };

/** A pre-lead the person can see (their own client: their own, or every one for admins), or null. */
async function visiblePreLead<T = Record<string, unknown>>(ctx: ActionContext, id: unknown, columns: string): Promise<T | null> {
  if (typeof id !== "string" || isStepRef(id)) return null;
  const { data } = await ctx.db.from("pre_leads").select(columns).eq("id", id).is("deleted_at", null).maybeSingle();
  return (data as T | null) ?? null;
}

/** The same read as POST /api/pre-leads/check-duplicate (service role, after the create permission). */
async function preLeadDuplicates(ctx: ActionContext, input: { business_name?: string; phone?: string; email?: string }) {
  const { data: rows } = await ctx.admin.from("pre_leads").select("id, business_name, phone_number, email, agent_id").is("deleted_at", null);
  const ownerIds = [...new Set((rows ?? []).map((r) => r.agent_id as string | null).filter((x): x is string => Boolean(x)))];
  const { data: profs } = ownerIds.length ? await ctx.admin.from("profiles").select("id, display_name").in("id", ownerIds) : { data: [] };
  const nameById = new Map((profs ?? []).map((p) => [p.id as string, p.display_name as string | null]));
  const dup: DupRow[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    business_name: r.business_name as string,
    phone: r.phone_number as string | null,
    email: r.email as string | null,
    owner: r.agent_id as string | null,
    ownerName: r.agent_id ? (nameById.get(r.agent_id as string) ?? null) : null,
  }));
  return findCollisions(input, dup, ctx.userId);
}

const DUP_FIELD: Record<string, string> = { business_name: "business_name", phone: "phone_number", email: "email" };

/* ------------------------------------------------------- prelead.create */

const createFields: FieldSpec[] = [
  { name: "service_offered", label: "Service offered", type: "enum", options: SERVICE_OFFERED, required: true, help: "What they are after: SEO or Website." },
  {
    name: "service_type",
    label: "Service type",
    type: "enum",
    options: SERVICE_TYPE,
    required: (v) => v.service_offered === "Website",
    help: "For a website: Redesign (they have a site) or Fresh (a new one).",
  },
  { name: "business_name", label: "Business name", type: "text", required: true, max: 200 },
  { name: "phone_number", label: "Phone", type: "phone", required: true, help: "The business's 10-digit US number." },
  { name: "email", label: "Email", type: "email" },
  { name: "owner_name", label: "Owner", type: "text", help: "The decision maker's name, if they gave it." },
  { name: "google_yelp_link", label: "Profile link", type: "url", required: true, help: "Their Google Maps or Yelp listing URL." },
  { name: "areas", label: "Areas", type: "list", max: 50, help: "The towns/areas the business serves." },
  { name: "services", label: "Services", type: "list", max: 50 },
  { name: "pricing", label: "Target price", type: "money", min: 0, help: "The estimated value, if it was discussed." },
  { name: "follow_up_time", label: "Next follow-up", type: "datetime", required: true, future: true },
  {
    name: "lead_category",
    label: "Category",
    type: "enum",
    options: LEAD_CATEGORIES,
    required: true,
    help: "Strong Lead, Weak Lead, Mockup, Long Term, Upfront or Call Backs. Ask — do not assume.",
  },
  { name: "comments", label: "Comments", type: "longtext", max: 4000, help: "Notes from the conversation." },
  { name: "override_duplicate", label: "Override duplicate", type: "boolean", hidden: true, help: "Only when the person explicitly says to save it despite a duplicate, and may override duplicates." },
];

/** The New Pre-Lead form's payload (buildPreLeadPayload), from an action's values. */
export function preLeadPayload(v: Values): Record<string, unknown> {
  return {
    business_name: str(v.business_name).trim(),
    lead_category: v.lead_category,
    // The form always files a new pre-lead as due for a follow-up.
    status: "Next follow up",
    service_offered: v.service_offered ?? null,
    service_type: v.service_type ?? null,
    phone_number: v.phone_number ?? null,
    email: v.email ?? null,
    owner_name: str(v.owner_name).trim() || null,
    google_yelp_link: v.google_yelp_link ?? null,
    pricing: typeof v.pricing === "number" ? v.pricing : null,
    areas: Array.isArray(v.areas) ? v.areas : [],
    services: Array.isArray(v.services) ? v.services : [],
    follow_up_time: v.follow_up_time ?? null,
    comments: str(v.comments).trim() || null,
  };
}

const preLeadCreate: ActionDef = {
  key: "prelead.create",
  group: "Pre-leads",
  title: "Add a pre-lead",
  description:
    "Add a prospect to Pre-leads exactly like the New Pre-Lead form: the service (SEO or Website — and for a website, Redesign or Fresh), business name, phone, profile link, category and next follow-up time are required. It runs the same duplicate check. Ask for anything missing — never invent a value.",
  confirmLabel: "Add pre-lead",
  risk: "standard",
  allowed: (ctx) => need(ctx, "pre_leads.create"),
  fields: createFields,
  label: (v) => str(v.business_name),
  produces: "pre_lead",
  minutesSaved: 3,
  async check(v, ctx): Promise<CheckResult> {
    const problems: Problem[] = [];
    const warnings: string[] = [];
    const dup = await preLeadDuplicates(ctx, {
      business_name: typeof v.business_name === "string" ? v.business_name : undefined,
      phone: typeof v.phone_number === "string" ? v.phone_number : undefined,
      email: typeof v.email === "string" ? v.email : undefined,
    });
    if (dup.length) {
      const owner = dup[0].isOwn ? "you" : (dup[0].ownerDisplayName ?? "another agent");
      const fields = dup.map((d) => d.field.replace("business_name", "name")).join(", ");
      const msg = `This business is already in Pre-leads (same ${fields}; ${owner} has it).`;
      const canOverride = ctx.perms.has("leads.duplicate.override");
      if (v.override_duplicate === true && canOverride) warnings.push(`${msg} Saving anyway, as you asked.`);
      else problems.push({ field: DUP_FIELD[dup[0].field] ?? "business_name", message: `${msg}${canOverride ? " Say if it should be saved anyway." : ""}` });
    }
    const extra = merge(
      typeof v.email === "string" ? await checkEmail("email", v.email) : NONE,
      typeof v.google_yelp_link === "string" ? await checkProfileLink("google_yelp_link", v.google_yelp_link, null) : NONE,
    );
    return { problems: [...problems, ...extra.problems], warnings: [...warnings, ...extra.warnings] };
  },
  async preview(v, ctx) {
    return { notes: [`Next follow-up: ${formatDateTime(String(v.follow_up_time), ctx.timezone, ctx.now)} (${ctx.timezone}).`, "The pre-lead will be yours."] };
  },
  async execute(v) {
    const res = await callRoute<{ id: string }>(preLeadsRoute, "POST", {
      path: "/api/pre-leads",
      body: { ...preLeadPayload(v), override: v.override_duplicate === true },
    });
    return { message: `Added the pre-lead ${str(v.business_name)}.`, link: preLeadLink(res.id), data: { id: res.id, kind: "pre_lead" } };
  },
  undo: {
    minutes: 10,
    async run(stored, ctx) {
      const id = stored.result?.data?.id;
      if (typeof id !== "string") throw new Error("Nothing to undo.");
      // As with a new lead: taking back a pre-lead you added minutes ago does
      // not need the delete permission — it is soft-deleted (an admin can
      // restore it) and logged. The endpoint makes its creator its owner.
      const { data: row } = await ctx.admin.from("pre_leads").select("id, agent_id, deleted_at").eq("id", id).maybeSingle();
      if (!row || row.deleted_at) return "The pre-lead was already removed.";
      if (row.agent_id !== stored.user_id) throw new Error("Only the person who added the pre-lead can undo adding it.");
      await ctx.admin.from("pre_leads").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      await ctx.admin.from("activity_log").insert({ user_id: ctx.userId, action: "pre_lead.deleted", entity_type: "pre_lead", entity_id: id, new_value: { via: "assistant_undo" } });
      return "the pre-lead was removed again.";
    },
  },
};

/* ------------------------------------------------------- prelead.update */

/** Keys the endpoint treats as a follow-up (pre_leads.followup); any other key needs pre_leads.edit. */
const FOLLOWUP_KEYS = new Set(["status", "lead_category", "follow_up_time", "reason"]);

const EDITABLE: FieldSpec[] = [
  { name: "status", label: "Status", type: "enum", options: PRELEAD_STATUSES, help: "Next follow up, Closed (won) or Dropped (lost)." },
  { name: "follow_up_time", label: "Next follow-up", type: "datetime", future: true },
  {
    name: "reason",
    label: "Follow-up note",
    type: "enum",
    options: FOLLOWUP_REASONS,
    help: "When logging a call that needs another follow-up: No Pickup or Rescheduled. Like the Follow-up button, it REPLACES the comments.",
  },
  { name: "lead_category", label: "Category", type: "enum", options: LEAD_CATEGORIES },
  { name: "business_name", label: "Business name", type: "text", max: 200 },
  { name: "owner_name", label: "Owner", type: "text" },
  { name: "phone_number", label: "Phone", type: "phone" },
  { name: "email", label: "Email", type: "email" },
  { name: "google_yelp_link", label: "Profile link", type: "url" },
  { name: "areas", label: "Areas", type: "list", max: 50 },
  { name: "services", label: "Services", type: "list", max: 50 },
  { name: "service_offered", label: "Service offered", type: "enum", options: SERVICE_OFFERED },
  { name: "service_type", label: "Service type", type: "enum", options: SERVICE_TYPE },
  { name: "pricing", label: "Target price", type: "money", min: 0 },
  { name: "comments", label: "Comments", type: "longtext", max: 4000 },
];
const EDIT_LABELS: Record<string, string> = { ...Object.fromEntries(EDITABLE.map((f) => [f.name, f.label])), comments: "Comments" };

const changedKeys = (v: Values) => EDITABLE.filter((f) => v[f.name] !== undefined).map((f) => f.name);

/** The values the endpoint will write: a follow-up note lands in the comments. */
function afterValues(v: Values): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of changedKeys(v)) if (k !== "reason") out[k] = v[k];
  if (v.reason !== undefined) out.comments = v.reason;
  return out;
}

const preLeadUpdate: ActionDef = {
  key: "prelead.update",
  group: "Pre-leads",
  title: "Work a pre-lead",
  description:
    "Change a pre-lead: log a follow-up (status Next follow up / Closed / Dropped, the next follow-up time, a No Pickup or Rescheduled note), change its category, or edit its details (name, phone, email, owner, profile link, areas, services, service, target price, comments). Only the fields given change. To turn it into a full lead use prelead.convert.",
  confirmLabel: "Save changes",
  risk: "standard",
  allowed: (ctx) => (ctx.perms.has("pre_leads.edit") || ctx.perms.has("pre_leads.followup") ? null : need(ctx, "pre_leads.edit")),
  fields: [{ name: "pre_lead", label: "Pre-lead", type: "ref", ref: "pre_lead", required: true, editable: false }, ...EDITABLE],
  label: (v) => str(v.__name),
  minutesSaved: 1,
  async check(v, ctx) {
    const problems: Problem[] = [];
    const keys = changedKeys(v);
    if (!keys.length) problems.push({ field: "_", message: "Say what to change on the pre-lead." });
    else {
      // The endpoint's own rule: only follow-up keys → pre_leads.followup; anything else → pre_leads.edit.
      const followUpOnly = keys.every((k) => FOLLOWUP_KEYS.has(k));
      const missing = need(ctx, followUpOnly ? "pre_leads.followup" : "pre_leads.edit");
      if (missing) {
        problems.push({ field: "_", message: followUpOnly ? missing : `${missing} It can only log follow-ups (status, category, next follow-up, follow-up note).` });
      }
    }
    const pre = await visiblePreLead<{ business_name: string; status: string | null }>(ctx, v.pre_lead, "business_name, status");
    if (typeof v.pre_lead === "string" && !isStepRef(v.pre_lead) && !pre) problems.push({ field: "pre_lead", message: "That pre-lead is not visible to you." });
    if (v.reason !== undefined && v.comments !== undefined) problems.push({ field: "reason", message: "The follow-up note replaces the comments — give one or the other." });
    // The Follow-up dialog offers the note only with "Next follow up".
    const statusAfter = v.status ?? pre?.status;
    if (v.reason !== undefined && statusAfter && statusAfter !== "Next follow up") {
      problems.push({ field: "reason", message: `A No Pickup / Rescheduled note only goes with Next follow up${v.status ? "" : ` — the pre-lead is ${statusAfter}; set the status too`}.` });
    }
    if (pre && keys.length === 1 && v.status !== undefined && v.status === pre.status) problems.push({ field: "status", message: `It is already ${pre.status}.` });
    const extra = merge(
      typeof v.email === "string" ? await checkEmail("email", v.email) : NONE,
      typeof v.google_yelp_link === "string" ? await checkProfileLink("google_yelp_link", v.google_yelp_link, null) : NONE,
    );
    return { problems: [...problems, ...extra.problems], warnings: extra.warnings, values: pre ? { __name: pre.business_name } : {} };
  },
  async preview(v, ctx) {
    const after = afterValues(v);
    const cols = ["id", "updated_at", "business_name", ...Object.keys(after)];
    const before = (await visiblePreLead<Record<string, unknown>>(ctx, v.pre_lead, [...new Set(cols)].join(", "))) ?? {};
    const show = (field: string, val: unknown) => {
      if (val === null || val === undefined || val === "") return "";
      if (field === "follow_up_time") return formatDateTime(String(val), ctx.timezone, ctx.now);
      if (field === "pricing") return money(Number(val));
      return displayValue(val);
    };
    return {
      title: `Update pre-lead — ${str(before.business_name) || str(v.__name)}`,
      fields: [],
      changes: changesOf(before, after, EDIT_LABELS, show),
      link: preLeadLink(str(v.pre_lead)),
      before,
    };
  },
  async stale(before, v, ctx) {
    return movedOn(before, await visiblePreLead<{ updated_at: string }>(ctx, v.pre_lead, "updated_at"));
  },
  async execute(v) {
    const body: Record<string, unknown> = {};
    for (const k of changedKeys(v)) body[k] = v[k];
    await callRoute(preLeadRoute, "PATCH", { path: `/api/pre-leads/${v.pre_lead}`, params: { id: str(v.pre_lead) }, body });
    return { message: `Updated ${str(v.__name) || "the pre-lead"} (${plural(Object.keys(body).length, "change")}).`, link: preLeadLink(str(v.pre_lead)), data: { id: v.pre_lead } };
  },
  undo: {
    async run(stored, ctx) {
      const before = (stored.before_state ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      for (const k of Object.keys(afterValues(stored.input))) {
        const prev = before[k] ?? null;
        // Required on the row: never sent back empty.
        if (prev === null && (k === "business_name" || k === "lead_category" || k === "status")) continue;
        body[k] = prev;
      }
      let note = "";
      if ("comments" in body && !ctx.perms.has("pre_leads.edit")) {
        // A follow-up-only account cannot write the comments directly; the
        // endpoint copies a follow-up note into them, so that is the way back.
        const prev = body.comments;
        delete body.comments;
        if (typeof prev === "string" && prev.trim()) body.reason = prev;
        else note = " (the comments keep the follow-up note — your account cannot clear them)";
      }
      if (!Object.keys(body).length) throw new Error("There is nothing your account can put back — change it in Pre-leads.");
      await callRoute(preLeadRoute, "PATCH", { path: `/api/pre-leads/${stored.input.pre_lead}`, params: { id: str(stored.input.pre_lead) }, body });
      return `the previous values are back${note}.`;
    },
  },
};

/* ------------------------------------------------------ prelead.convert */

const leadCreate = LEAD_ACTIONS.find((d) => d.key === "lead.create")!;

interface PreLeadRow {
  id: string;
  business_name: string;
  phone_number: string | null;
  email: string | null;
  owner_name: string | null;
  google_yelp_link: string | null;
  areas: string[] | null;
  services: string[] | null;
  service_offered: string | null;
  service_type: string | null;
  comments: string | null;
  agent_id: string | null;
  status: string | null;
  updated_at: string;
}
const PRELEAD_COLUMNS =
  "id, business_name, phone_number, email, owner_name, google_yelp_link, areas, services, service_offered, service_type, comments, agent_id, status, updated_at";

/*
 * COPYING THE PRE-LEAD. The lead's fields DEFAULT to what the pre-lead already
 * has, so the framework fills exactly what the person did not say, shows the
 * copied values on the card (and to the model), and counts as missing only
 * what neither gave. Defaults may be async: each reads the pre-lead through a
 * per-request cache (the context object is the key), so it is loaded once.
 */
const loaded = new WeakMap<ActionContext, Map<string, Promise<PreLeadRow | null>>>();

function loadPreLead(ctx: ActionContext, id: unknown): Promise<PreLeadRow | null> {
  if (typeof id !== "string" || isStepRef(id)) return Promise.resolve(null);
  let cache = loaded.get(ctx);
  if (!cache) loaded.set(ctx, (cache = new Map()));
  if (!cache.has(id)) cache.set(id, visiblePreLead<PreLeadRow>(ctx, id, PRELEAD_COLUMNS));
  return cache.get(id)!;
}

/** Lead field → what the pre-lead holds for it (undefined: nothing to copy). */
const COPY: Record<string, (p: PreLeadRow) => unknown> = {
  business_name: (p) => p.business_name,
  owner_name: (p) => p.owner_name,
  business_phone: (p) => p.phone_number,
  business_email: (p) => p.email,
  business_profile_link: (p) => p.google_yelp_link,
  // Read off the profile link — only when it is plainly a Google or Yelp page.
  platform: (p) => {
    const on = profilePlatform(normalizeUrl(p.google_yelp_link) ?? "");
    return on === "Google" || on === "Yelp" ? on : undefined;
  },
  // "Fresh" could be any of the new-site types; only a redesign maps one to one.
  site_type: (p) => (p.service_offered === "Website" && p.service_type === "Redesign" ? "Redesign" : undefined),
  has_service_areas: (p) => (p.areas?.length ? true : undefined),
  service_areas: (p) => p.areas ?? undefined,
  services: (p) => p.services ?? undefined,
  comments: (p) => p.comments,
  // Whose pre-lead it was (lead.create's own check keeps it yours without leads.assign).
  agent: (p) => p.agent_id,
};

function copied(f: FieldSpec): FieldSpec {
  const pick = COPY[f.name];
  if (!pick) return f;
  const fallback = f.default;
  return {
    ...f,
    default: async (ctx: ActionContext, v: Values) => {
      const p = await loadPreLead(ctx, v.pre_lead);
      const value = p ? pick(p) : undefined;
      if (!isBlank(value)) return value;
      return typeof fallback === "function" ? (fallback as (c: ActionContext, x: Values) => unknown)(ctx, v) : fallback;
    },
  };
}

const convertFields: FieldSpec[] = [
  { name: "pre_lead", label: "Pre-lead", type: "ref", ref: "pre_lead", required: true, editable: false, help: "The pre-lead to turn into a lead." },
  ...LEAD_CREATE_FIELDS.map(copied),
];

const preLeadConvert: ActionDef = {
  key: "prelead.convert",
  group: "Pre-leads",
  title: "Turn a pre-lead into a lead",
  description:
    "Create a full lead (the New Lead form, same rules as lead.create) from a pre-lead. What the pre-lead already has is copied — name, owner, phone, email, profile link (and Google/Yelp from it), areas, services, comments, its agent — and only the rest is asked for; anything the person says overrides the copy. The pre-lead is then marked Closed. Ask for every missing lead field — never invent a value.",
  confirmLabel: "Create lead",
  risk: "standard",
  // POST /api/leads, then PATCH /api/pre-leads/[id] {status} (a follow-up key).
  allowed: (ctx) => need(ctx, "leads.create", "pre_leads.followup"),
  fields: convertFields,
  label: (v) => str(v.business_name),
  produces: "lead",
  minutesSaved: 8,
  async check(v, ctx): Promise<CheckResult> {
    const problems: Problem[] = [];
    const warnings: string[] = [];
    const pre = await loadPreLead(ctx, v.pre_lead);
    if (typeof v.pre_lead === "string" && !isStepRef(v.pre_lead) && !pre) problems.push({ field: "pre_lead", message: "That pre-lead is not visible to you." });
    if (pre?.status === "Closed") warnings.push(`${pre.business_name} is already Closed — check it was not turned into a lead before.`);
    if (pre?.status === "Dropped") warnings.push(`${pre.business_name} was Dropped.`);
    // Then exactly lead.create's checks: duplicates, email, profile link, colours and the endpoint's own rules.
    const lead = (await leadCreate.check?.(v, ctx)) ?? {};
    return {
      problems: [...problems, ...(lead.problems ?? [])],
      warnings: [...warnings, ...(lead.warnings ?? [])],
      values: { ...(lead.values ?? {}), ...(pre ? { __pre_name: pre.business_name, __pre_status: pre.status ?? "" } : {}) },
    };
  },
  async preview(v, ctx) {
    const base = leadCreate.preview ? await leadCreate.preview(v, ctx) : {};
    const pre = await loadPreLead(ctx, v.pre_lead);
    const name = pre?.business_name ?? str(v.__pre_name);
    const notes = [...(base.notes ?? [])];
    if (pre?.status !== "Closed") notes.push(`The pre-lead ${name} is then marked Closed.`);
    return {
      ...base,
      title: `Turn pre-lead ${name} into a lead`,
      notes,
      link: preLeadLink(str(v.pre_lead)),
      before: pre ? { id: pre.id, status: pre.status, updated_at: pre.updated_at } : null,
    };
  },
  async stale(before, v, ctx) {
    // What was copied must still be what the pre-lead says.
    return before ? movedOn(before, await visiblePreLead<{ updated_at: string }>(ctx, v.pre_lead, "updated_at")) : null;
  },
  async execute(v, ctx, info) {
    // The same POST /api/leads as lead.create, with the same payload.
    const created = await leadCreate.execute(v, ctx, info);
    const leadId = str(created.data?.id);
    let closed = false;
    let trouble = "";
    if (v.__pre_status !== "Closed") {
      try {
        await callRoute(preLeadRoute, "PATCH", { path: `/api/pre-leads/${v.pre_lead}`, params: { id: str(v.pre_lead) }, body: { status: "Closed" } });
        closed = true;
      } catch (e) {
        // The lead exists by now: report the pre-lead rather than fail the action.
        trouble = ` The pre-lead could not be marked Closed (${e instanceof Error ? e.message : "unknown error"}) — close it in Pre-leads.`;
      }
    }
    return {
      message: `Created the lead ${str(v.business_name)} from the pre-lead.${closed ? " The pre-lead is now Closed." : ""}${trouble}`,
      link: created.link,
      data: { id: leadId, kind: "lead", pre_lead: v.pre_lead, pre_lead_closed: closed },
    };
  },
  undo: {
    minutes: 10,
    async run(stored, ctx) {
      // lead.create's own undo removes the lead (its creator only)…
      const removed = await leadCreate.undo!.run(stored, ctx);
      // …and the pre-lead goes back to the status it had.
      const before = (stored.before_state ?? null) as { status?: string | null } | null;
      if (stored.result?.data?.pre_lead_closed === true && before?.status) {
        await callRoute(preLeadRoute, "PATCH", { path: `/api/pre-leads/${stored.input.pre_lead}`, params: { id: str(stored.input.pre_lead) }, body: { status: before.status } });
        return `${removed.replace(/\.$/, "")}, and the pre-lead is ${before.status} again.`;
      }
      return removed;
    },
  },
};

export const PRELEAD_ACTIONS: ActionDef[] = [preLeadCreate, preLeadUpdate, preLeadConvert];
