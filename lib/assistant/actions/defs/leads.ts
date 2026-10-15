import { settableStatuses, statusSetError } from "@/lib/leads/categories";
import { CLOSED_BY_MESSAGE, isAllowedClosedBy } from "@/lib/leads/closedBy";
import { findCollisions, type DupRow } from "@/lib/leads/duplicate";
import { endsFollowUps, FU_STATUSES, isFollowUpEligible } from "@/lib/leads/followups";
import { PAGE_OPTIONS, pageTotal, PLATFORM_OPTIONS } from "@/lib/leads/newLeadForm";
import { leadPayloadErrors } from "@/lib/leads/serverRules";
import { FRESH_OPTIONS, LEAD_STATUSES, SITE_TYPES, type AddOn, type SocialProfile } from "@/lib/leads/types";
import { attachmentUrl } from "../../uploads";
import type { CardItem } from "../card";
import { ActionFailure } from "../errors";
import { checkColors, checkEmail, checkProfileLink, merge } from "../checks";
import { formatDateTime, money } from "../fields";
import { changesOf, displayValue, isStepRef, movedOn, need, needAdmin, plural, str, visibleLead } from "../helpers";
import { callRoute } from "../invoke";
import type { ActionContext, ActionDef, CheckResult, FieldSpec, Problem, Values } from "../types";

/**
 * Lead actions: create, edit, status, log a call, reschedule, tags, assign,
 * bulk changes, archive. Every one runs through the same endpoint the lead
 * screens use (see ../invoke.ts), so the app's rules apply unchanged.
 */

const leadsRoute = () => import("@/app/api/leads/route");
const leadRoute = () => import("@/app/api/leads/[id]/route");
const followUpsRoute = () => import("@/app/api/leads/[id]/follow-ups/route");
const leadTagsRoute = () => import("@/app/api/leads/[id]/tags/route");
const tagsRoute = () => import("@/app/api/tags/route");
const bulkRoute = () => import("@/app/api/leads/bulk/route");

const leadLink = (id: string, label = "Open lead") => ({ href: `/leads/${id}`, label });

/* -------------------------------------------------------------- helpers */

async function addOns(ctx: ActionContext): Promise<AddOn[]> {
  const { data } = await ctx.db.from("website_addons").select("id, label, price").eq("is_active", true).order("sort");
  return ((data ?? []) as { id: string; label: string; price: number | null }[]).map((a) => ({ id: a.id, label: a.label, price: a.price }));
}

const SOCIAL_HOSTS: [RegExp, string][] = [
  [/(^|\.)facebook\.com$|(^|\.)fb\.com$/i, "Facebook"],
  [/(^|\.)instagram\.com$/i, "Instagram"],
  [/(^|\.)tiktok\.com$/i, "TikTok"],
  [/(^|\.)(x|twitter)\.com$/i, "X"],
];

export function socialProfilesFrom(urls: string[]): SocialProfile[] {
  return urls.map((u) => {
    let host = "";
    try {
      host = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname;
    } catch {
      /* keep as Other */
    }
    const hit = SOCIAL_HOSTS.find(([re]) => re.test(host));
    return hit ? { platform: hit[1], url: u, label: null } : { platform: "Other", url: u, label: host.replace(/^www\./, "") || "Profile" };
  });
}

/** The New Lead form's payload, built from an action's values. */
export async function leadPayload(v: Values, ctx: ActionContext): Promise<Record<string, unknown>> {
  const services = (v.services as string[] | undefined) ?? [];
  const hasAreas = v.has_service_areas === true;
  const areas = hasAreas ? ((v.service_areas as string[] | undefined) ?? []) : [];
  const chosen = (v.specify_pages as string[] | undefined) ?? [];
  const pages = chosen.map((p) => (p === "Other" ? str(v.other_page).trim() || "Other" : p));
  const yearly = str(v.yearly_price).trim();
  const catalogue = Array.isArray(v.add_ons) && v.add_ons.length ? await addOns(ctx) : [];
  const picked = catalogue.filter((a) => (v.add_ons as string[]).includes(a.label));
  return {
    business_name: str(v.business_name).trim(),
    owner_name: str(v.owner_name).trim() || null,
    status: str(v.status) || "Not Ready",
    agent_id: typeof v.agent === "string" ? v.agent : null,
    site_type: v.site_type ?? null,
    business_phone: v.business_phone ?? null,
    no_email: v.no_email === true,
    business_email: v.no_email === true ? null : (v.business_email ?? null),
    business_profile_link: v.business_profile_link ?? null,
    platform: v.platform === "Other" ? str(v.other_platform).trim() || null : (v.platform ?? null),
    custom_area: str(v.custom_area).trim() || null,
    category: str(v.category).trim() || null,
    map_embed_link: v.map_embed_link ?? null,
    has_service_areas: typeof v.has_service_areas === "boolean" ? v.has_service_areas : null,
    service_areas: areas.length ? areas : null,
    services: services.length ? services : null,
    client_experience: typeof v.client_experience === "number" ? v.client_experience : null,
    num_webpages: pageTotal(chosen, services.length, areas.length) || null,
    specify_pages: pages.length ? pages : null,
    color_same_as_logo: false,
    color_scheme: v.color_scheme ?? null,
    logo_via_sms: v.logo_via_sms === true,
    // A chat attachment is only published when the lead is actually created.
    logo_link: v.logo_via_sms === true ? null : (v.logo_link ?? null),
    design_reference_links: Array.isArray(v.design_reference_links) && v.design_reference_links.length ? v.design_reference_links : null,
    add_ons: picked.length ? picked : null,
    image_links: Array.isArray(v.image_links) && v.image_links.length ? v.image_links : null,
    follow_up_time: v.follow_up_time ?? null,
    price_quoted: typeof v.price_quoted === "number" ? v.price_quoted : null,
    yearly_price: !yearly ? "None" : /^none$/i.test(yearly) ? "None" : yearly.replace(/^\$/, ""),
    direct_line_saved: typeof v.direct_line_saved === "boolean" ? v.direct_line_saved : null,
    reference_link: v.site_type === "Redesign" ? (v.reference_link ?? null) : null,
    rating: typeof v.rating === "number" ? v.rating : null,
    fresh_or_followup: v.fresh_or_followup ?? null,
    about_business: str(v.about_business).trim() || null,
    developer_instructions: str(v.developer_instructions).trim() || null,
    recommended_template_id: typeof v.recommended_template === "string" ? v.recommended_template : null,
    social_profiles: Array.isArray(v.social_profiles) && v.social_profiles.length ? socialProfilesFrom(v.social_profiles as string[]) : null,
    comments: str(v.comments).trim() || null,
    closed_by: typeof v.closed_by === "string" ? v.closed_by : ctx.userId,
  };
}

/** The payload rules' field names → this action's field names. */
const PAYLOAD_TO_FIELD: Record<string, string> = { service_areas: "service_areas", specify_pages: "specify_pages", closed_by: "closed_by" };

async function duplicates(ctx: ActionContext, input: { business_name?: string; phone?: string; email?: string }) {
  const { data: leads } = await ctx.admin.from("leads").select("id, business_name, business_phone, business_email, agent_id").is("deleted_at", null);
  const ownerIds = [...new Set((leads ?? []).map((l) => l.agent_id as string | null).filter((x): x is string => Boolean(x)))];
  const { data: profs } = ownerIds.length ? await ctx.admin.from("profiles").select("id, display_name").in("id", ownerIds) : { data: [] };
  const nameById = new Map((profs ?? []).map((p) => [p.id as string, p.display_name as string | null]));
  const rows: DupRow[] = (leads ?? []).map((l) => ({
    id: l.id as string,
    business_name: l.business_name as string,
    phone: l.business_phone as string | null,
    email: l.business_email as string | null,
    owner: l.agent_id as string | null,
    ownerName: l.agent_id ? (nameById.get(l.agent_id as string) ?? null) : null,
  }));
  return findCollisions(input, rows, ctx.userId);
}

const DUP_FIELD: Record<string, string> = { business_name: "business_name", phone: "business_phone", email: "business_email" };

/* ---------------------------------------------------------- lead.create */

const createFields: FieldSpec[] = [
  { name: "business_name", label: "Business name", type: "text", required: true, max: 200 },
  { name: "owner_name", label: "Owner", type: "text", help: "The owner's own name, if they gave it." },
  { name: "business_phone", label: "Phone", type: "phone", required: true, help: "The business's 10-digit US number." },
  { name: "no_email", label: "Has no email", type: "boolean", default: false, help: "true only when the business has no email address at all." },
  { name: "business_email", label: "Email", type: "email", required: true, showIf: (v) => v.no_email !== true },
  { name: "site_type", label: "Site type", type: "enum", options: SITE_TYPES, required: true },
  { name: "reference_link", label: "Current website", type: "url", showIf: (v) => v.site_type === "Redesign", help: "The site being redesigned (optional)." },
  { name: "platform", label: "Found on", type: "enum", options: PLATFORM_OPTIONS, required: true, help: "Where their listing is: Google, Yelp or Other." },
  { name: "other_platform", label: "Platform name", type: "text", required: true, showIf: (v) => v.platform === "Other" },
  { name: "business_profile_link", label: "Profile link", type: "url", required: true, help: "Their Google Maps / Yelp listing URL." },
  { name: "category", label: "Category", type: "text", help: "The kind of business: Plumber, Roofing, Bakery…" },
  { name: "custom_area", label: "State (override)", type: "text", help: "Only when the business is not in the state its phone's area code suggests." },
  { name: "map_embed_link", label: "Map embed link", type: "url" },
  { name: "has_service_areas", label: "Has service areas", type: "boolean", required: true, help: "Does the business serve several towns/areas (yes/no)?" },
  { name: "service_areas", label: "Service areas", type: "list", required: true, min: 1, showIf: (v) => v.has_service_areas === true },
  { name: "services", label: "Services", type: "list", required: true, min: 1, help: "What the business offers, one entry per service." },
  { name: "client_experience", label: "Years in business", type: "integer", required: true, min: 0, max: 200 },
  {
    name: "specify_pages",
    label: "Pages",
    type: "multi",
    options: PAGE_OPTIONS,
    required: true,
    min: 1,
    help: "Which pages the website gets. Ask — do not assume Home only.",
  },
  { name: "other_page", label: "Other page", type: "text", showIf: (v) => Array.isArray(v.specify_pages) && v.specify_pages.includes("Other") },
  {
    name: "color_scheme",
    label: "Colours",
    type: "colors",
    required: true,
    min: 2,
    max: 3,
    help: "2–3 colours in order: primary (brand), secondary, complementary. Hex or common names.",
  },
  { name: "logo_via_sms", label: "Logo coming by SMS", type: "boolean", default: false },
  { name: "logo_link", label: "Logo", type: "attachment", showIf: (v) => v.logo_via_sms !== true, help: "A link to the logo, or a logo image attached in this chat." },
  { name: "image_links", label: "Image links", type: "list", max: 30 },
  { name: "design_reference_links", label: "Design references", type: "list", max: 3, help: "Up to 3 websites the client likes." },
  { name: "add_ons", label: "Add-ons", type: "multi", options: async (ctx) => (await addOns(ctx)).map((a) => a.label) },
  { name: "follow_up_time", label: "Follow-up", type: "datetime", required: true, future: true },
  { name: "price_quoted", label: "Price quoted", type: "money", required: true, min: 0 },
  { name: "yearly_price", label: "Yearly renewal", type: "text", help: "100, 50, another amount, or None (default None)." },
  { name: "direct_line_saved", label: "Direct line saved", type: "boolean" },
  { name: "about_business", label: "About the business", type: "longtext", max: 4000 },
  { name: "developer_instructions", label: "Build instructions", type: "longtext", max: 8000 },
  { name: "social_profiles", label: "Social profiles", type: "list", max: 10, help: "Facebook / Instagram / TikTok / X links." },
  { name: "recommended_template", label: "Template", type: "ref", ref: "builder_template" },
  { name: "comments", label: "Comments", type: "longtext", required: true, help: "The agent's notes about the client and the call." },
  { name: "rating", label: "Rating", type: "rating", required: true, min: 1, max: 10, help: "How promising the lead is, 1–10." },
  { name: "fresh_or_followup", label: "Fresh or follow-up", type: "enum", options: FRESH_OPTIONS, required: true },
  {
    name: "status",
    label: "Status",
    type: "enum",
    options: (ctx) => (ctx.perms.has("leads.set_status") ? settableStatuses(ctx.perms) : ["Not Ready"]),
    default: "Not Ready",
  },
  { name: "agent", label: "Agent", type: "ref", ref: "user", refFilter: "active", default: (ctx: ActionContext) => ctx.userId, help: "Whose lead it is (default: the person asking)." },
  {
    name: "closed_by",
    label: "Closed by",
    type: "ref",
    ref: "user",
    default: (ctx: ActionContext) => ctx.userId,
    help: "Who closed the deal: the person asking, or a member of the Closing department (default: the person asking).",
  },
  { name: "override_duplicate", label: "Override duplicate", type: "boolean", hidden: true, help: "Only when the person explicitly says to save it despite a duplicate, and may override duplicates." },
];

const leadCreate: ActionDef = {
  key: "lead.create",
  group: "Leads",
  title: "Create a lead",
  description:
    "Submit a new lead exactly like the New Lead form: every field the form requires must be filled. Ask the person for anything missing — never invent a value.",
  confirmLabel: "Create lead",
  risk: "standard",
  allowed: (ctx) => need(ctx, "leads.create"),
  fields: createFields,
  label: (v) => str(v.business_name),
  produces: "lead",
  minutesSaved: 6,
  async check(v, ctx): Promise<CheckResult> {
    const problems: Problem[] = [];
    const warnings: string[] = [];
    const notes: string[] = [];
    const values: Values = {};

    // Assignment and status follow the server's own coercion, said up front.
    if (typeof v.agent === "string" && v.agent !== ctx.userId && !ctx.perms.has("leads.assign")) {
      warnings.push("You can't assign leads to someone else, so this lead will be yours.");
      values.agent = ctx.userId;
    }
    if (typeof v.status === "string" && ctx.perms.has("leads.set_status")) {
      const err = statusSetError(ctx.perms, v.status);
      if (err) problems.push({ field: "status", message: err });
    }
    if (typeof v.closed_by === "string" && !(await isAllowedClosedBy(ctx.admin, ctx.userId, v.closed_by))) {
      problems.push({ field: "closed_by", message: CLOSED_BY_MESSAGE });
    }

    // Already in the system? Checked as soon as there is a name, phone or email.
    const dup = await duplicates(ctx, {
      business_name: typeof v.business_name === "string" ? v.business_name : undefined,
      phone: typeof v.business_phone === "string" ? v.business_phone : undefined,
      email: v.no_email === true || typeof v.business_email !== "string" ? undefined : v.business_email,
    });
    if (dup.length) {
      const owner = dup[0].isOwn ? "you" : (dup[0].ownerDisplayName ?? "another agent");
      const fields = dup.map((d) => d.field.replace("business_name", "name")).join(", ");
      const msg = `This business is already in the system (same ${fields}; ${owner} has it).`;
      if (v.override_duplicate === true && ctx.perms.has("leads.duplicate.override")) warnings.push(`${msg} Saving anyway, as you asked.`);
      else problems.push({ field: DUP_FIELD[dup[0].field] ?? "business_name", message: `${msg}${ctx.perms.has("leads.duplicate.override") ? " Say if it should be saved anyway." : ""}` });
    }

    // The free data checks: email deliverability, profile link, colours.
    const extra = merge(
      typeof v.business_email === "string" && v.no_email !== true ? await checkEmail("business_email", v.business_email) : { problems: [], warnings: [], notes: [] },
      typeof v.business_profile_link === "string" ? await checkProfileLink("business_profile_link", v.business_profile_link, typeof v.platform === "string" ? v.platform : null) : { problems: [], warnings: [], notes: [] },
      typeof v.color_scheme === "string" ? checkColors("color_scheme", v.color_scheme) : { problems: [], warnings: [], notes: [] },
    );
    problems.push(...extra.problems);
    warnings.push(...extra.warnings);
    notes.push(...extra.notes);
    if (notes.length) values.__notes = notes;

    // Finally the server's own rules, on the payload it will receive — a lead
    // this accepts is a lead POST /api/leads accepts.
    const payload = await leadPayload({ ...v, ...values }, ctx);
    if (typeof payload.logo_link === "string" && payload.logo_link.startsWith("upload:")) payload.logo_link = "https://placeholder.invalid/logo";
    for (const [field, message] of Object.entries(leadPayloadErrors(payload, ctx.now))) {
      const name = PAYLOAD_TO_FIELD[field] ?? field;
      if (!problems.some((p) => p.field === name)) problems.push({ field: name === "platform" && v.platform === "Other" ? "other_platform" : name, message });
    }
    return { problems, warnings, values };
  },
  async preview(v, ctx) {
    const notes = Array.isArray(v.__notes) ? (v.__notes as string[]) : [];
    delete v.__notes;
    if (!ctx.perms.has("leads.set_status")) notes.push("It is saved as Not Ready (your account cannot set a status on new leads).");
    if (v.agent === ctx.userId) notes.push("The lead will be yours.");
    notes.push(`Follow-up: ${formatDateTime(String(v.follow_up_time), ctx.timezone, ctx.now)} (${ctx.timezone}).`);
    return { notes };
  },
  async execute(v, ctx) {
    const payload = await leadPayload(v, ctx);
    payload.logo_link = await attachmentUrl(ctx.admin, ctx.ownerId ?? ctx.userId, payload.logo_link);
    const res = await callRoute<{ id: string }>(leadsRoute, "POST", {
      path: "/api/leads",
      body: { ...payload, override: v.override_duplicate === true },
    });
    return { message: `Created the lead ${payload.business_name}.`, link: leadLink(res.id), data: { id: res.id, kind: "lead" } };
  },
  undo: {
    minutes: 10,
    async run(stored, ctx) {
      const id = stored.result?.data?.id;
      if (typeof id !== "string") throw new ActionFailure("Nothing to undo.", 409);
      // Removing a lead you created minutes ago does not need the delete
      // permission: the lead is soft-deleted (restorable by an admin) and logged.
      const { data: lead } = await ctx.admin.from("leads").select("id, created_by, deleted_at").eq("id", id).maybeSingle();
      if (!lead || lead.deleted_at) return "The lead was already removed.";
      if (lead.created_by !== stored.user_id) throw new ActionFailure("Only the lead's creator can undo creating it.", 403);
      await ctx.admin.from("leads").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      await ctx.admin.from("activity_log").insert({ user_id: ctx.userId, action: "lead.deleted", entity_type: "lead", entity_id: id, new_value: { via: "assistant_undo" } });
      return "the lead was removed again.";
    },
  },
};

/* ---------------------------------------------------------- lead.update */

const EDITABLE: FieldSpec[] = [
  { name: "business_name", label: "Business name", type: "text", max: 200 },
  { name: "owner_name", label: "Owner", type: "text" },
  { name: "business_phone", label: "Phone", type: "phone" },
  { name: "business_email", label: "Email", type: "email" },
  { name: "business_profile_link", label: "Profile link", type: "url" },
  { name: "website_link", label: "Website link", type: "url" },
  { name: "category", label: "Category", type: "text" },
  { name: "custom_area", label: "State (override)", type: "text" },
  { name: "site_type", label: "Site type", type: "enum", options: SITE_TYPES },
  { name: "reference_link", label: "Current website", type: "url" },
  { name: "services", label: "Services", type: "list" },
  { name: "has_service_areas", label: "Has service areas", type: "boolean" },
  { name: "service_areas", label: "Service areas", type: "list" },
  { name: "client_experience", label: "Years in business", type: "integer", min: 0, max: 200 },
  { name: "color_scheme", label: "Colours", type: "colors", min: 2, max: 3 },
  { name: "logo_link", label: "Logo", type: "attachment" },
  { name: "price_quoted", label: "Price quoted", type: "money", min: 0 },
  { name: "yearly_price", label: "Yearly renewal", type: "text" },
  { name: "direct_line_saved", label: "Direct line saved", type: "boolean" },
  { name: "about_business", label: "About the business", type: "longtext", max: 4000 },
  { name: "developer_instructions", label: "Build instructions", type: "longtext", max: 8000 },
  { name: "comments", label: "Comments", type: "longtext" },
  { name: "rating", label: "Rating", type: "rating", min: 1, max: 10, help: "Admins only." },
  { name: "closed_by", label: "Closed by", type: "ref", ref: "user", help: "Admins only." },
];
const EDIT_LABELS = Object.fromEntries(EDITABLE.map((f) => [f.name, f.label]));

const leadUpdate: ActionDef = {
  key: "lead.update",
  group: "Leads",
  title: "Edit a lead",
  description:
    "Change one or more details of an existing lead (name, phone, email, links, services, colours, price, comments…). Only the fields given change. For the status use lead.status; for the agent, lead.assign.",
  confirmLabel: "Save changes",
  risk: "standard",
  allowed: (ctx) => need(ctx, "leads.edit"),
  fields: [{ name: "lead", label: "Lead", type: "ref", ref: "lead", required: true, editable: false }, ...EDITABLE],
  label: (v) => str(v.__name),
  minutesSaved: 2,
  async check(v, ctx) {
    const problems: Problem[] = [];
    const changes = EDITABLE.filter((f) => v[f.name] !== undefined);
    if (!changes.length) problems.push({ field: "_", message: "Say what to change on the lead." });
    if ((v.rating !== undefined || v.closed_by !== undefined) && !ctx.isAdmin) {
      problems.push({ field: v.rating !== undefined ? "rating" : "closed_by", message: "Only an admin can change the rating or closed by." });
    }
    if (typeof v.closed_by === "string" && !(await isAllowedClosedBy(ctx.admin, ctx.userId, v.closed_by))) problems.push({ field: "closed_by", message: CLOSED_BY_MESSAGE });
    const extra = merge(
      typeof v.business_email === "string" ? await checkEmail("business_email", v.business_email) : { problems: [], warnings: [], notes: [] },
      typeof v.color_scheme === "string" ? checkColors("color_scheme", v.color_scheme) : { problems: [], warnings: [], notes: [] },
    );
    const lead = await visibleLead<{ business_name: string }>(ctx, v.lead, "business_name");
    if (typeof v.lead === "string" && !lead) problems.push({ field: "lead", message: "That lead is not visible to you." });
    return { problems: [...problems, ...extra.problems], warnings: extra.warnings, values: lead ? { __name: lead.business_name } : {} };
  },
  async preview(v, ctx) {
    const fields = EDITABLE.filter((f) => v[f.name] !== undefined).map((f) => f.name);
    const before = (await visibleLead<Record<string, unknown>>(ctx, v.lead, ["id", "updated_at", "business_name", ...fields].join(", "))) ?? {};
    return {
      title: `Edit lead — ${str(before.business_name)}`,
      fields: [],
      changes: changesOf(before, Object.fromEntries(fields.map((f) => [f, v[f]])), EDIT_LABELS),
      link: leadLink(str(v.lead)),
      before,
    };
  },
  async stale(before, v, ctx) {
    return movedOn(before, await visibleLead<{ updated_at: string }>(ctx, v.lead, "updated_at"));
  },
  async execute(v, ctx) {
    const body: Record<string, unknown> = {};
    for (const f of EDITABLE) if (v[f.name] !== undefined) body[f.name] = v[f.name];
    if (body.logo_link !== undefined) body.logo_link = await attachmentUrl(ctx.admin, ctx.ownerId ?? ctx.userId, body.logo_link);
    if (Array.isArray(body.service_areas)) body.has_service_areas = (body.service_areas as string[]).length > 0;
    await callRoute(leadRoute, "PATCH", { path: `/api/leads/${v.lead}`, params: { id: str(v.lead) }, body });
    return { message: `Updated ${str(v.__name) || "the lead"} (${plural(Object.keys(body).length, "field")}).`, link: leadLink(str(v.lead)), data: { id: v.lead } };
  },
  undo: {
    async run(stored) {
      const before = (stored.before_state ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      for (const f of EDITABLE) if (stored.input[f.name] !== undefined) body[f.name] = before[f.name] ?? null;
      await callRoute(leadRoute, "PATCH", { path: `/api/leads/${stored.input.lead}`, params: { id: str(stored.input.lead) }, body });
      return "the previous values are back.";
    },
  },
};

/* ---------------------------------------------------------- lead.status */

const leadStatus: ActionDef = {
  key: "lead.status",
  group: "Leads",
  title: "Change a lead's status",
  description: "Move a lead to Ready, Not Ready, Closed, Dropped or Long Term. Ready needs the website link.",
  confirmLabel: "Change status",
  risk: (v) => (v.status === "Closed" || v.status === "Dropped" ? "sensitive" : "standard"),
  allowed: (ctx) => need(ctx, "leads.status_change"),
  fields: [
    { name: "lead", label: "Lead", type: "ref", ref: "lead", required: true, editable: false },
    { name: "status", label: "New status", type: "enum", options: (ctx) => settableStatuses(ctx.perms), required: true },
    { name: "website_link", label: "Website link", type: "url", help: "Required to set Ready when the lead has none yet." },
  ],
  label: (v) => str(v.__name),
  minutesSaved: 1,
  async check(v, ctx) {
    const lead = await visibleLead<{ business_name: string; status: string; website_link: string | null }>(ctx, v.lead, "business_name, status, website_link");
    const problems: Problem[] = [];
    if (typeof v.lead === "string" && !lead) problems.push({ field: "lead", message: "That lead is not visible to you." });
    if (lead && v.status === lead.status) problems.push({ field: "status", message: `It is already ${lead.status}.` });
    else if (lead && v.status === "Ready" && !lead.website_link && !v.website_link) {
      problems.push({ field: "website_link", message: "A website link is required before a lead can be set to Ready. What is the site's link?" });
    }
    return { problems, values: lead ? { __name: lead.business_name } : {} };
  },
  async preview(v, ctx) {
    const before = (await visibleLead<Record<string, unknown>>(ctx, v.lead, "id, updated_at, business_name, status, website_link")) ?? {};
    const notes: string[] = [];
    if (v.status === "Closed") notes.push("Accounts is alerted to send the payment receipt.");
    if (v.status === "Ready") notes.push("The agent is told the website is ready.");
    return {
      title: `${str(before.business_name)}: ${str(before.status)} → ${str(v.status)}`,
      fields: [],
      changes: changesOf(before, { status: v.status, ...(v.website_link ? { website_link: v.website_link } : {}) }, { status: "Status", website_link: "Website link" }),
      notes,
      link: leadLink(str(v.lead)),
      before,
    };
  },
  async stale(before, v, ctx) {
    const now = await visibleLead<{ status: string }>(ctx, v.lead, "status");
    const b = before as { status?: string };
    if (!now) return "the lead no longer exists (or you can no longer see it).";
    return b.status && now.status !== b.status ? `its status changed to ${now.status} in the meantime.` : null;
  },
  async execute(v) {
    await callRoute(leadRoute, "PATCH", {
      path: `/api/leads/${v.lead}`,
      params: { id: str(v.lead) },
      body: { status: v.status, ...(v.website_link ? { website_link: v.website_link } : {}) },
    });
    return { message: `${str(v.__name)} is now ${str(v.status)}.`, link: leadLink(str(v.lead)), data: { id: v.lead } };
  },
  undo: {
    async run(stored) {
      const before = (stored.before_state ?? {}) as { status?: string };
      if (!before.status) throw new Error("The previous status is unknown.");
      await callRoute(leadRoute, "PATCH", { path: `/api/leads/${stored.input.lead}`, params: { id: str(stored.input.lead) }, body: { status: before.status } });
      return `it is ${before.status} again.`;
    },
  },
};

/* -------------------------------------------------------- lead.followup */

const leadFollowup: ActionDef = {
  key: "lead.followup",
  group: "Leads",
  title: "Log a follow-up call",
  description:
    "Record a follow-up call on a Ready or Long Term lead: Pickup or No Pickup, what was said, and when to call next (not needed when the lead is being Dropped). Optionally change the status on a Pickup.",
  confirmLabel: "Log call",
  risk: "standard",
  allowed: (ctx) => need(ctx, "leads.followup"),
  fields: [
    { name: "lead", label: "Lead", type: "ref", ref: "lead", required: true, editable: false },
    { name: "outcome", label: "Outcome", type: "enum", options: FU_STATUSES, required: true, help: "Pickup = they answered; No Pickup = no answer." },
    { name: "comments", label: "What was said", type: "longtext", showIf: (v) => v.outcome === "Pickup", required: (v) => v.outcome === "Pickup" },
    { name: "status_change", label: "Change status to", type: "enum", options: (ctx) => settableStatuses(ctx.perms), showIf: (v) => v.outcome === "Pickup" },
    {
      name: "next_follow_up_time",
      label: "Next call",
      type: "datetime",
      future: true,
      required: (v) => v.status_change !== "Dropped",
      showIf: (v) => v.status_change !== "Dropped",
    },
    { name: "is_specific_time", label: "Exact time agreed", type: "boolean", default: false, help: "true when the customer asked for exactly that time." },
  ],
  label: (v) => str(v.__name),
  minutesSaved: 1,
  async check(v, ctx) {
    const lead = await visibleLead<{ business_name: string; status: string }>(ctx, v.lead, "business_name, status");
    const problems: Problem[] = [];
    if (typeof v.lead === "string" && !lead) problems.push({ field: "lead", message: "That lead is not visible to you." });
    if (lead && !isFollowUpEligible(lead.status)) problems.push({ field: "lead", message: `Follow-ups apply only to Ready or Long Term leads; this one is ${lead.status}.` });
    if (typeof v.status_change === "string") {
      const err = statusSetError(ctx.perms, v.status_change);
      if (err) problems.push({ field: "status_change", message: err });
    }
    return { problems, values: lead ? { __name: lead.business_name } : {} };
  },
  async preview(v) {
    return { title: `Log ${str(v.outcome)} — ${str(v.__name)}`, link: leadLink(str(v.lead)) };
  },
  async execute(v) {
    const isPickup = v.outcome === "Pickup";
    await callRoute(followUpsRoute, "POST", {
      path: `/api/leads/${v.lead}/follow-ups`,
      params: { id: str(v.lead) },
      body: {
        fu_status: v.outcome,
        comments: isPickup ? (v.comments ?? null) : null,
        next_follow_up_time: endsFollowUps(str(v.status_change)) ? null : (v.next_follow_up_time ?? null),
        is_specific_time: v.is_specific_time === true,
        status_change: isPickup ? (v.status_change ?? null) : null,
      },
    });
    return { message: `Logged a ${str(v.outcome)} on ${str(v.__name)}.`, link: leadLink(str(v.lead)), data: { id: v.lead } };
  },
};

/* ------------------------------------------------------ lead.reschedule */

const leadReschedule: ActionDef = {
  key: "lead.reschedule",
  group: "Leads",
  title: "Reschedule follow-ups",
  description: "Move the next follow-up of one or more leads to a new time, without logging a call. Each lead can be unticked on the card.",
  confirmLabel: "Reschedule",
  risk: (v) => (Array.isArray(v.leads) && v.leads.length > 5 ? "sensitive" : "standard"),
  allowed: (ctx) => need(ctx, "leads.edit"),
  fields: [
    { name: "leads", label: "Leads", type: "refs", ref: "lead", required: true, min: 1, max: 200, editable: false },
    { name: "follow_up_time", label: "New follow-up", type: "datetime", required: true, future: true },
  ],
  bulkField: "leads",
  minutesSaved: 1,
  async preview(v, ctx) {
    const ids = v.leads as string[];
    const { data } = await ctx.db.from("leads").select("id, business_name, follow_up_time, updated_at").in("id", ids).is("deleted_at", null);
    const rows = (data ?? []) as { id: string; business_name: string; follow_up_time: string | null; updated_at: string }[];
    const items: CardItem[] = rows.map((r) => ({
      id: r.id,
      label: r.business_name,
      detail: r.follow_up_time ? `was ${formatDateTime(r.follow_up_time, ctx.timezone, ctx.now)}` : "no follow-up set",
      href: `/leads/${r.id}`,
      selected: true,
    }));
    return {
      title: `Reschedule ${plural(rows.length, "follow-up")} to ${formatDateTime(String(v.follow_up_time), ctx.timezone, ctx.now)}`,
      items,
      before: Object.fromEntries(rows.map((r) => [r.id, r.follow_up_time])),
    };
  },
  async execute(v) {
    const ids = v.leads as string[];
    const failed: string[] = [];
    for (const id of ids) {
      try {
        await callRoute(leadRoute, "PATCH", { path: `/api/leads/${id}`, params: { id }, body: { follow_up_time: v.follow_up_time } });
      } catch {
        failed.push(id);
      }
    }
    if (failed.length === ids.length) throw new Error("None of the follow-ups could be moved.");
    return {
      message: `Moved ${plural(ids.length - failed.length, "follow-up")}${failed.length ? ` (${failed.length} could not be changed)` : ""}.`,
      data: { ids: ids.filter((i) => !failed.includes(i)) },
    };
  },
  undo: {
    async run(stored) {
      const before = (stored.before_state ?? {}) as Record<string, string | null>;
      const ids = (stored.result?.data?.ids as string[] | undefined) ?? [];
      for (const id of ids) await callRoute(leadRoute, "PATCH", { path: `/api/leads/${id}`, params: { id }, body: { follow_up_time: before[id] ?? null } });
      return `${plural(ids.length, "follow-up")} moved back.`;
    },
  },
};

/* ------------------------------------------------------------ lead.tags */

const leadTags: ActionDef = {
  key: "lead.tags",
  group: "Leads",
  title: "Tag a lead",
  description: "Add or remove your own tags on a lead. Tags you name that do not exist yet are created for you.",
  confirmLabel: "Update tags",
  risk: "standard",
  allowed: (ctx) => need(ctx, "leads.tags.manage"),
  // Tags are each person's own: never applied by an approver in their place.
  selfOnly: true,
  fields: [
    { name: "lead", label: "Lead", type: "ref", ref: "lead", required: true, editable: false },
    { name: "add", label: "Add tags", type: "list", max: 20 },
    { name: "remove", label: "Remove tags", type: "list", max: 20 },
  ],
  label: (v) => str(v.__name),
  minutesSaved: 1,
  async check(v, ctx) {
    const problems: Problem[] = [];
    if (!(v.add as string[] | undefined)?.length && !(v.remove as string[] | undefined)?.length) problems.push({ field: "_", message: "Say which tags to add or remove." });
    const lead = await visibleLead<{ business_name: string }>(ctx, v.lead, "business_name");
    if (typeof v.lead === "string" && !lead) problems.push({ field: "lead", message: "That lead is not visible to you." });
    if (((v.add as string[] | undefined) ?? []).some((t) => t.length > 40)) problems.push({ field: "add", message: "A tag name is at most 40 characters." });
    return { problems, values: lead ? { __name: lead.business_name } : {} };
  },
  async preview(v, ctx) {
    const [{ data: mine }, { data: links }] = await Promise.all([
      ctx.admin.from("lead_tags").select("id, name").eq("owner_id", ctx.userId),
      ctx.admin.from("lead_tag_links").select("tag_id").eq("lead_id", str(v.lead)).eq("added_by", ctx.userId),
    ]);
    const byId = new Map(((mine ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
    const current = ((links ?? []) as { tag_id: string }[]).map((l) => l.tag_id);
    const add = (v.add as string[] | undefined) ?? [];
    const created = add.filter((n) => ![...byId.values()].some((x) => x.toLowerCase() === n.toLowerCase()));
    return {
      title: `Tags on ${str(v.__name)}`,
      changes: [{ label: "Your tags", from: current.map((id) => byId.get(id)).filter(Boolean).join(", ") || "—", to: nextTagNames(current.map((id) => byId.get(id) ?? ""), add, (v.remove as string[]) ?? []).join(", ") || "—" }],
      notes: created.length ? [`New tag${created.length === 1 ? "" : "s"} created: ${created.join(", ")}.`] : undefined,
      link: leadLink(str(v.lead)),
      before: { tagIds: current },
    };
  },
  async execute(v, ctx) {
    const { data: mine } = await ctx.admin.from("lead_tags").select("id, name").eq("owner_id", ctx.userId);
    const tags = new Map(((mine ?? []) as { id: string; name: string }[]).map((t) => [t.name.toLowerCase(), t.id]));
    for (const name of (v.add as string[] | undefined) ?? []) {
      if (tags.has(name.toLowerCase())) continue;
      const created = await callRoute<{ tag?: { id: string }; id?: string }>(tagsRoute, "POST", { path: "/api/tags", body: { name } });
      const id = created.tag?.id ?? created.id;
      if (id) tags.set(name.toLowerCase(), id);
    }
    const { data: links } = await ctx.admin.from("lead_tag_links").select("tag_id").eq("lead_id", str(v.lead)).eq("added_by", ctx.userId);
    const set = new Set(((links ?? []) as { tag_id: string }[]).map((l) => l.tag_id));
    for (const n of (v.add as string[] | undefined) ?? []) {
      const id = tags.get(n.toLowerCase());
      if (id) set.add(id);
    }
    for (const n of (v.remove as string[] | undefined) ?? []) {
      const id = tags.get(n.toLowerCase());
      if (id) set.delete(id);
    }
    await callRoute(leadTagsRoute, "PUT", { path: `/api/leads/${v.lead}/tags`, params: { id: str(v.lead) }, body: { tagIds: [...set] } });
    return { message: `Updated the tags on ${str(v.__name)}.`, link: leadLink(str(v.lead)), data: { id: v.lead } };
  },
  undo: {
    async run(stored) {
      const before = (stored.before_state ?? {}) as { tagIds?: string[] };
      await callRoute(leadTagsRoute, "PUT", { path: `/api/leads/${stored.input.lead}/tags`, params: { id: str(stored.input.lead) }, body: { tagIds: before.tagIds ?? [] } });
      return "the tags are as they were.";
    },
  },
};

function nextTagNames(current: string[], add: string[], remove: string[]): string[] {
  const out = current.filter(Boolean);
  for (const a of add) if (!out.some((x) => x.toLowerCase() === a.toLowerCase())) out.push(a);
  return out.filter((x) => !remove.some((r) => r.toLowerCase() === x.toLowerCase()));
}

/* ----------------------------------------------------------- lead.assign */

const leadAssign: ActionDef = {
  key: "lead.assign",
  group: "Leads",
  title: "Assign leads to an agent",
  description: "Give one or more leads to a Sales agent (admins only — the same rule as the lead screens).",
  confirmLabel: "Assign",
  risk: "sensitive",
  allowed: (ctx) => needAdmin(ctx, "leads.assign"),
  fields: [
    { name: "leads", label: "Leads", type: "refs", ref: "lead", required: true, min: 1, max: 500, editable: false },
    { name: "agent", label: "Give to", type: "ref", ref: "user", refFilter: "dept:sales", required: true },
  ],
  bulkField: "leads",
  minutesSaved: 1,
  async preview(v, ctx) {
    const ids = v.leads as string[];
    const { data } = await ctx.admin.from("leads").select("id, business_name, agent_id").in("id", ids).is("deleted_at", null);
    const rows = (data ?? []) as { id: string; business_name: string; agent_id: string | null }[];
    const owners = [...new Set(rows.map((r) => r.agent_id).filter((x): x is string => Boolean(x)))];
    const { data: profs } = owners.length ? await ctx.admin.from("profiles").select("id, display_name").in("id", owners) : { data: [] };
    const names = new Map(((profs ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
    const { data: target } = await ctx.admin.from("profiles").select("display_name").eq("id", str(v.agent)).maybeSingle();
    return {
      title: `Give ${plural(rows.length, "lead")} to ${str((target as { display_name?: string } | null)?.display_name)}`,
      items: rows.map((r) => ({ id: r.id, label: r.business_name, detail: `now ${r.agent_id ? (names.get(r.agent_id) ?? "someone") : "nobody"}`, href: `/leads/${r.id}`, selected: true })),
      before: Object.fromEntries(rows.map((r) => [r.id, r.agent_id])),
    };
  },
  async execute(v) {
    const ids = v.leads as string[];
    await callRoute(bulkRoute, "POST", { path: "/api/leads/bulk", body: { ids, action: "assign", value: v.agent } });
    return { message: `Assigned ${plural(ids.length, "lead")}.`, data: { ids } };
  },
  undo: {
    async run(stored) {
      const before = (stored.before_state ?? {}) as Record<string, string | null>;
      const ids = (stored.result?.data?.ids as string[] | undefined) ?? [];
      // Back to each lead's own previous agent, grouped so it is one call per agent.
      const byAgent = new Map<string, string[]>();
      for (const id of ids) {
        const prev = before[id] ?? "";
        byAgent.set(prev, [...(byAgent.get(prev) ?? []), id]);
      }
      for (const [agent, group] of byAgent) await callRoute(bulkRoute, "POST", { path: "/api/leads/bulk", body: { ids: group, action: "assign", value: agent || undefined } });
      return "every lead is back with its previous agent.";
    },
  },
};

/* ------------------------------------------------------------- lead.bulk */

const BULK_OPS = ["Change status", "Add tags", "Archive"] as const;

const leadBulk: ActionDef = {
  key: "lead.bulk",
  group: "Leads",
  title: "Change many leads at once",
  description:
    "One change applied to a list of leads: change their status, add your tags, or archive them. The card lists every lead so the person can untick any before confirming. Find the leads first (search), then pass their ids.",
  confirmLabel: "Apply to selected",
  risk: (v) => (v.operation === "Archive" ? "critical" : "sensitive"),
  allowed: () => null,
  fields: [
    { name: "leads", label: "Leads", type: "refs", ref: "lead", required: true, min: 1, max: 500, editable: false },
    { name: "operation", label: "Change", type: "enum", options: BULK_OPS, required: true, editable: false },
    { name: "status", label: "New status", type: "enum", options: (ctx) => settableStatuses(ctx.perms), required: true, showIf: (v) => v.operation === "Change status" },
    { name: "tags", label: "Tags to add", type: "list", required: true, min: 1, showIf: (v) => v.operation === "Add tags" },
  ],
  bulkField: "leads",
  minutesSaved: 3,
  async check(v, ctx) {
    const op = v.operation;
    const problems: Problem[] = [];
    const reason =
      op === "Change status" ? need(ctx, "leads.status_change") : op === "Add tags" ? need(ctx, "leads.tags.manage") : op === "Archive" ? need(ctx, "leads.delete") : null;
    if (reason) problems.push({ field: "operation", message: reason });
    if (op === "Change status" && typeof v.status === "string") {
      const err = statusSetError(ctx.perms, v.status);
      if (err) problems.push({ field: "status", message: err });
    }
    if (op === "Add tags" && Array.isArray(v.tags)) {
      const { data: mine } = await ctx.admin.from("lead_tags").select("name").eq("owner_id", ctx.userId);
      const names = new Set(((mine ?? []) as { name: string }[]).map((t) => t.name.toLowerCase()));
      const unknown = (v.tags as string[]).filter((t) => !names.has(t.toLowerCase()));
      if (unknown.length) problems.push({ field: "tags", message: `You have no tag called ${unknown.join(", ")}. Create it first (tag one lead with it), or pick an existing tag.` });
    }
    return { problems };
  },
  async preview(v, ctx) {
    const ids = v.leads as string[];
    const { data } = await ctx.db.from("leads").select("id, business_name, status").in("id", ids).is("deleted_at", null);
    const rows = (data ?? []) as { id: string; business_name: string; status: string }[];
    const what = v.operation === "Change status" ? `to ${str(v.status)}` : v.operation === "Add tags" ? `: tag ${(v.tags as string[]).join(", ")}` : "";
    const before: Record<string, unknown> = { statuses: Object.fromEntries(rows.map((r) => [r.id, r.status])) };
    if (v.operation === "Add tags") {
      const { data: links } = await ctx.admin.from("lead_tag_links").select("lead_id, tag_id").in("lead_id", ids).eq("added_by", ctx.userId);
      before.links = links ?? [];
    }
    return {
      title: `${str(v.operation)} ${what} — ${plural(rows.length, "lead")}`.replace(/\s+/g, " "),
      items: rows.map((r) => ({ id: r.id, label: r.business_name, detail: r.status, href: `/leads/${r.id}`, selected: true })),
      warnings: v.operation === "Archive" ? ["Archived leads disappear from every list (an admin can restore them)."] : undefined,
      confirmPhrase: v.operation === "Archive" ? `archive ${rows.length}` : undefined,
      before,
    };
  },
  async execute(v, ctx) {
    const ids = v.leads as string[];
    let value: string | undefined;
    let action: string;
    if (v.operation === "Change status") {
      action = "status";
      value = str(v.status);
    } else if (v.operation === "Add tags") {
      action = "tag";
      const { data: mine } = await ctx.admin.from("lead_tags").select("id, name").eq("owner_id", ctx.userId);
      const tags = ((mine ?? []) as { id: string; name: string }[]).filter((t) => (v.tags as string[]).some((n) => n.toLowerCase() === t.name.toLowerCase()));
      value = tags.map((t) => t.id).join(",");
    } else action = "archive";
    const res = await callRoute<{ updated?: number }>(bulkRoute, "POST", { path: "/api/leads/bulk", body: { ids, action, value } });
    return { message: `${str(v.operation)}: done for ${plural(res.updated ?? ids.length, "lead")}.`, data: { ids, value } };
  },
  undo: {
    async run(stored, ctx) {
      const ids = (stored.result?.data?.ids as string[] | undefined) ?? [];
      const before = (stored.before_state ?? {}) as { statuses?: Record<string, string>; links?: { lead_id: string; tag_id: string }[] };
      const op = stored.input.operation;
      if (op === "Archive") {
        // Bringing archived leads back is what the delete permission covers — whoever clicks Undo.
        const blocked = need(ctx, "leads.delete");
        if (blocked) throw new ActionFailure(blocked, 403);
        await ctx.admin.from("leads").update({ deleted_at: null }).in("id", ids);
        await ctx.admin.from("activity_log").insert({ user_id: ctx.userId, action: "lead.restored", entity_type: "lead", new_value: { ids, via: "assistant_undo" } });
        return `${plural(ids.length, "lead")} restored.`;
      }
      if (op === "Change status") {
        const byStatus = new Map<string, string[]>();
        for (const id of ids) {
          const s = before.statuses?.[id];
          if (s) byStatus.set(s, [...(byStatus.get(s) ?? []), id]);
        }
        for (const [status, group] of byStatus) await callRoute(bulkRoute, "POST", { path: "/api/leads/bulk", body: { ids: group, action: "status", value: status } });
        return "every lead has its previous status again.";
      }
      // Tags: remove only the links this action added.
      const had = new Set((before.links ?? []).map((l) => `${l.lead_id}:${l.tag_id}`));
      const tagIds = str(stored.result?.data?.value).split(",").filter(Boolean);
      for (const leadId of ids) {
        const added = tagIds.filter((t) => !had.has(`${leadId}:${t}`));
        if (added.length) await ctx.admin.from("lead_tag_links").delete().eq("lead_id", leadId).eq("added_by", ctx.userId).in("tag_id", added);
      }
      return "the tags added are removed again.";
    },
  },
};

/* ---------------------------------------------------------- lead.archive */

const leadArchive: ActionDef = {
  key: "lead.archive",
  group: "Leads",
  title: "Archive (delete) a lead",
  description: "Remove a lead from every list — the app's Delete Lead. An admin can restore it.",
  confirmLabel: "Archive lead",
  risk: "critical",
  allowed: (ctx) => need(ctx, "leads.delete"),
  fields: [
    { name: "lead", label: "Lead", type: "ref", ref: "lead", required: true, editable: false },
    { name: "reason", label: "Why", type: "text", help: "Optional: noted in the activity log." },
  ],
  label: (v) => str(v.__name),
  minutesSaved: 1,
  async check(v, ctx) {
    const lead = await visibleLead<{ business_name: string }>(ctx, v.lead, "business_name");
    return { problems: typeof v.lead === "string" && !lead ? [{ field: "lead", message: "That lead is not visible to you." }] : [], values: lead ? { __name: lead.business_name } : {} };
  },
  async preview(v) {
    return { title: `Archive ${str(v.__name)}`, warnings: ["The lead disappears from every list, with its follow-ups and tickets."], confirmPhrase: str(v.__name), link: leadLink(str(v.lead)) };
  },
  async execute(v) {
    await callRoute(leadRoute, "DELETE", { path: `/api/leads/${v.lead}`, params: { id: str(v.lead) } });
    return { message: `Archived ${str(v.__name)}.`, data: { id: v.lead } };
  },
  undo: {
    async run(stored, ctx) {
      // Bringing an archived lead back is what the delete permission covers — whoever clicks Undo.
      const blocked = need(ctx, "leads.delete");
      if (blocked) throw new ActionFailure(blocked, 403);
      await ctx.admin.from("leads").update({ deleted_at: null }).eq("id", str(stored.input.lead));
      await ctx.admin.from("activity_log").insert({ user_id: ctx.userId, action: "lead.restored", entity_type: "lead", entity_id: str(stored.input.lead), new_value: { via: "assistant_undo" } });
      return "the lead is back.";
    },
  },
};

export const LEAD_ACTIONS: ActionDef[] = [leadCreate, leadUpdate, leadStatus, leadFollowup, leadReschedule, leadTags, leadAssign, leadBulk, leadArchive];

/** Shared with other groups (pre-lead conversion fills the same fields). */
export { createFields as LEAD_CREATE_FIELDS, displayValue, isStepRef, money, LEAD_STATUSES };
