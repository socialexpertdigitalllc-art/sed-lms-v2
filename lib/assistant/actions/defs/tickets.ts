import { canTransition, isTicketEligible, slaDueDate } from "@/lib/tickets/logic";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_SIGNATURES, type TicketPriority, type TicketStatus } from "@/lib/tickets/types";
import { getUpload, readUpload } from "../../uploads";
import type { CardChange } from "../card";
import { formatDateTime, UPLOAD_PREFIX } from "../fields";
import { isStepRef, movedOn, need, plural, str, visibleLead } from "../helpers";
import { callRoute } from "../invoke";
import type { ActionContext, ActionDef, CheckResult, Problem } from "../types";

/**
 * Ticket actions: open one on a lead, assign it, work it (start, tick its
 * changes), resolve it, reopen it. Every change runs through the endpoints the
 * ticket screens use (see ../invoke.ts), so their permission and scope rules,
 * notifications and activity log apply unchanged.
 */

const leadTicketsRoute = () => import("@/app/api/leads/[id]/tickets/route");
const ticketRoute = () => import("@/app/api/tickets/[id]/route");
const itemRoute = () => import("@/app/api/tickets/[id]/items/[itemId]/route");

const ticketLink = (id: string) => ({ href: `/tickets/${id}`, label: "Open ticket" });

/* -------------------------------------------------------------- helpers */

interface TicketRow {
  id: string;
  title: string | null;
  status: TicketStatus;
  lead_id: string;
  created_by: string | null;
  assigned_to: string | null;
  updated_at: string;
  resolution_note: string | null;
  leads: { business_name?: string; website_link?: string | null } | { business_name?: string; website_link?: string | null }[] | null;
}

export interface ItemRow {
  id: string;
  body: string;
  is_done: boolean;
  sort: number;
}

/**
 * The ticket, read the way the Tickets page reads it (service role). The
 * ticket field has already applied the page's scope rule (canActOnTicket)
 * when it resolved the name, and does so again on Confirm.
 */
async function ticketOf(ctx: ActionContext, id: unknown): Promise<TicketRow | null> {
  if (typeof id !== "string" || isStepRef(id)) return null;
  const { data } = await ctx.admin
    .from("lead_tickets")
    .select("id, title, status, lead_id, created_by, assigned_to, updated_at, resolution_note, leads(business_name, website_link)")
    .eq("id", id)
    .maybeSingle();
  return (data as TicketRow | null) ?? null;
}

export async function itemsOf(ctx: ActionContext, ticketId: string): Promise<ItemRow[]> {
  const { data } = await ctx.admin.from("ticket_items").select("id, body, is_done, sort").eq("ticket_id", ticketId).order("sort");
  return ((data ?? []) as ItemRow[]).sort((a, b) => a.sort - b.sort);
}

const leadOf = (t: TicketRow) => (Array.isArray(t.leads) ? t.leads[0] : t.leads) ?? null;

/** "Fix the header (Jumbo's Pizza)" — the ticket's title, else its first change. */
function ticketName(t: TicketRow, items: ItemRow[] = []): string {
  const what = t.title?.trim() || items[0]?.body.slice(0, 60) || "Ticket";
  const business = leadOf(t)?.business_name;
  return business ? `${what} (${business})` : what;
}

async function personName(ctx: ActionContext, id: unknown): Promise<string> {
  if (typeof id !== "string" || !id) return "";
  const { data } = await ctx.admin.from("profiles").select("display_name, email").eq("id", id).maybeSingle();
  const row = data as { display_name?: string | null; email?: string | null } | null;
  return str(row?.display_name || row?.email);
}

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []);
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The ticket's changes a person named — by number ("2", "#2"), by id, by
 * text, or by a part of the text that only one change has; "all" is every
 * change. Names that match nothing, or several, come back as problems.
 */
export function pickItems(names: string[], items: ItemRow[], field: string): { ids: string[]; problems: Problem[] } {
  const ids: string[] = [];
  const problems: Problem[] = [];
  const numbered = (it: ItemRow) => `${items.indexOf(it) + 1}. ${it.body}`.slice(0, 120);
  const add = (id: string) => {
    if (!ids.includes(id)) ids.push(id);
  };
  for (const raw of names) {
    const q = raw.trim();
    if (/^all$/i.test(q)) {
      items.forEach((it) => add(it.id));
      continue;
    }
    const num = /^#?(\d{1,3})$/.exec(q);
    let hits: ItemRow[];
    if (num) hits = items[Number(num[1]) - 1] ? [items[Number(num[1]) - 1]] : [];
    else {
      const n = squash(q);
      hits = items.filter((it) => it.id === q);
      if (!hits.length) hits = items.filter((it) => squash(it.body) === n);
      if (!hits.length && n) hits = items.filter((it) => squash(it.body).includes(n));
    }
    if (hits.length === 1) add(hits[0].id);
    else if (!hits.length) problems.push({ field, message: `No change on this ticket matches "${q}".`, choices: items.map(numbered) });
    else problems.push({ field, message: `"${q}" matches ${hits.length} changes on this ticket — which one?`, choices: hits.map(numbered) });
  }
  return { ids, problems };
}

/* --------------------------------------------------------- ticket.create */

const DEFAULT_SLA: Record<TicketPriority, number> = { Low: 168, Normal: 72, High: 24 };

/** The ticket deadlines from the company settings (the lead page reads them the same way). */
async function ticketSla(ctx: ActionContext): Promise<Record<TicketPriority, number>> {
  const { data } = await ctx.admin.from("app_settings").select("ticket_sla").eq("singleton", true).maybeSingle();
  const sla = (data as { ticket_sla?: Partial<Record<TicketPriority, number>> | null } | null)?.ticket_sla;
  return { ...DEFAULT_SLA, ...(sla ?? {}) };
}

/** The endpoint skips (silently) any file that is not an image or is over 5 MB; the form allows 5 per change. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES_PER_CHANGE = 5;

/** Which change (0-based) each screenshot goes with — by default the first. */
export function imageSlots(raw: unknown, images: number, changes: number): { slots: number[] } | { problem: string } {
  let slots: number[];
  if (raw === undefined || raw === null || raw === "") slots = Array(images).fill(0);
  else {
    const parts = Array.isArray(raw) ? raw : String(raw).split(/[\s,;]+/).filter(Boolean);
    const nums = parts.map((x) => Number(String(x).trim().replace(/^#/, "")));
    if (nums.length !== images) return { problem: `Give one change number per screenshot: ${plural(images, "screenshot")}, ${plural(nums.length, "number")}.` };
    if (nums.some((n) => !Number.isInteger(n) || n < 1 || n > changes)) return { problem: `Each number must be one of the ticket's changes, 1 to ${changes}.` };
    slots = nums.map((n) => n - 1);
  }
  const crowded = slots.find((s) => slots.filter((x) => x === s).length > MAX_IMAGES_PER_CHANGE);
  if (crowded !== undefined) return { problem: `At most ${MAX_IMAGES_PER_CHANGE} screenshots per change — say which change each one shows.` };
  return { slots };
}

const ticketCreate: ActionDef = {
  key: "ticket.create",
  group: "Tickets",
  title: "Open a ticket",
  description:
    "Open a website ticket on a lead (Ready, Long Term or Closed), like the New ticket form: its type (Changes or Improvement), who it is requested by (Agent or Closer) and the list of changes, one entry per change. Optional: priority, title, due date, and screenshots attached in this chat (with which change each one shows). Ask for what is missing — never invent it.",
  confirmLabel: "Open ticket",
  risk: "standard",
  allowed: (ctx) => need(ctx, "tickets.create"),
  fields: [
    { name: "lead", label: "Lead", type: "ref", ref: "lead", required: true, editable: false, help: "The lead whose website needs the work." },
    {
      name: "category",
      label: "Type",
      type: "enum",
      options: TICKET_CATEGORIES,
      required: true,
      help: "Changes = the client asked for changes to their site; Improvement = something we want to improve. Ask if it is not clear.",
    },
    {
      name: "signature",
      label: "Requested by",
      type: "enum",
      options: TICKET_SIGNATURES,
      required: true,
      help: "Who signs the request for the client: the lead's Agent or its Closer. Ask if it is not clear.",
    },
    { name: "items", label: "Changes", type: "list", required: true, min: 1, max: 50, help: "The changes requested, one entry per change (pass a list). Each becomes a checklist item." },
    { name: "priority", label: "Priority", type: "enum", options: TICKET_PRIORITIES, default: "Normal" },
    { name: "title", label: "Title", type: "text", max: 200, help: "Optional short summary (default: the first change)." },
    { name: "due_date", label: "Due", type: "datetime", future: true, help: "Optional. Default: the priority's deadline from the ticket settings, as the form sets it." },
    { name: "images", label: "Screenshots", type: "attachments", max: 10, help: "Images attached in this chat that show the changes." },
    {
      name: "image_items",
      label: "Screenshot goes with",
      type: "json",
      showIf: (v) => Array.isArray(v.images) && v.images.length > 0,
      help: "One number per screenshot, in order: the change it shows (1 = the first change), e.g. [1, 1, 3]. Default: every screenshot goes with change 1.",
    },
  ],
  label: (v) => str(v.__name),
  produces: "ticket",
  minutesSaved: 3,
  async check(v, ctx): Promise<CheckResult> {
    const problems: Problem[] = [];
    const lead = await visibleLead<{ business_name: string; status: string }>(ctx, v.lead, "business_name, status");
    if (typeof v.lead === "string" && !isStepRef(v.lead) && !lead) problems.push({ field: "lead", message: "That lead is not visible to you." });
    if (lead && !isTicketEligible(lead.status)) {
      problems.push({ field: "lead", message: `Tickets apply only to Ready, Long Term, or Closed leads — ${lead.business_name} is ${lead.status}.` });
    }
    const images = asList(v.images);
    for (const img of images) {
      if (!img.startsWith(UPLOAD_PREFIX)) {
        problems.push({ field: "images", message: "Screenshots must be attached in this chat — a link cannot be added to a ticket (put it in the change's text instead)." });
        break;
      }
      const up = await getUpload(ctx.admin, ctx.ownerId ?? ctx.userId, img.slice(UPLOAD_PREFIX.length));
      if (!up) problems.push({ field: "images", message: "An attached file is gone — attach it again." });
      else if (!up.mime.startsWith("image/")) problems.push({ field: "images", message: `${up.name} is not an image — tickets take images only.` });
      else if (up.size_bytes > MAX_IMAGE_BYTES) problems.push({ field: "images", message: `${up.name} is over 5 MB — tickets take images up to 5 MB.` });
    }
    const changes = asList(v.items);
    if (images.length && changes.length) {
      const s = imageSlots(v.image_items, images.length, changes.length);
      if ("problem" in s) problems.push({ field: v.image_items === undefined ? "images" : "image_items", message: s.problem });
    }
    return { problems, values: lead ? { __name: lead.business_name } : {} };
  },
  async preview(v, ctx) {
    const changes = asList(v.items);
    const priority = (str(v.priority) || "Normal") as TicketPriority;
    const notes = ["Admins are told it needs assigning."];
    if (typeof v.due_date !== "string") {
      const sla = await ticketSla(ctx);
      notes.push(`Due ${formatDateTime(slaDueDate(priority, sla, ctx.now.toISOString()), ctx.timezone, ctx.now)} — the ${priority}-priority deadline (${sla[priority]} hours).`);
    }
    const images = asList(v.images);
    const s = images.length ? imageSlots(v.image_items, images.length, changes.length) : null;
    if (s && "slots" in s) {
      const per = [...new Set(s.slots)].map((slot) => `${plural(s.slots.filter((x) => x === slot).length, "screenshot")} with change ${slot + 1}`);
      notes.push(`Screenshots: ${per.join(", ")}.`);
    }
    notes.push("This cannot be undone: the app has no way to delete a ticket.");
    return {
      title: `Open a ticket on ${str(v.__name) || "the lead"}: ${str(v.title) || changes[0] || ""}`.slice(0, 200),
      notes,
      link: typeof v.lead === "string" && !isStepRef(v.lead) ? { href: `/leads/${v.lead}`, label: "Open lead" } : null,
    };
  },
  async execute(v, ctx) {
    const lead = str(v.lead);
    const changes = asList(v.items);
    const priority = (str(v.priority) || "Normal") as TicketPriority;
    // No due date given: the priority's deadline from now, as the form fills it in.
    const due = typeof v.due_date === "string" ? v.due_date : slaDueDate(priority, await ticketSla(ctx), ctx.now.toISOString());
    const form = new FormData();
    form.append("payload", JSON.stringify({ category: v.category, signature: v.signature, priority, title: str(v.title).trim() || null, due_date: due, items: changes }));
    // Screenshots ride as item_<n> parts — n is the change's index, which the endpoint stores as its sort.
    const images = asList(v.images);
    const s = images.length ? imageSlots(v.image_items, images.length, changes.length) : { slots: [] };
    if ("problem" in s) throw new Error(s.problem);
    for (let i = 0; i < images.length; i++) {
      const { row, blob } = await readUpload(ctx.admin, ctx.ownerId ?? ctx.userId, images[i].slice(UPLOAD_PREFIX.length));
      form.append(`item_${s.slots[i]}`, new File([blob], row.name, { type: row.mime }));
    }
    const res = await callRoute<{ ticket: { id: string } }>(leadTicketsRoute, "POST", { path: `/api/leads/${lead}/tickets`, params: { id: lead }, form });
    return {
      message: `Opened a ticket on ${str(v.__name) || "the lead"} with ${plural(changes.length, "change")}${images.length ? ` and ${plural(images.length, "screenshot")}` : ""}.`,
      link: ticketLink(res.ticket.id),
      data: { id: res.ticket.id, kind: "ticket" },
    };
  },
};

/* --------------------------------------------------------- ticket.assign */

/** The endpoint's rule (and the picker's list): only Tech department members take tickets. */
async function isTech(ctx: ActionContext, userId: string): Promise<boolean> {
  const { data: dept } = await ctx.admin.from("departments").select("id").eq("slug", "tech").maybeSingle();
  if (!dept) return false;
  const { data } = await ctx.admin.from("department_members").select("user_id").eq("department_id", (dept as { id: string }).id).eq("user_id", userId).maybeSingle();
  return Boolean(data);
}

const ticketAssign: ActionDef = {
  key: "ticket.assign",
  group: "Tickets",
  title: "Assign a ticket",
  description: "Give an Open or Assigned ticket to a member of the Tech department (or move it to another one). They are notified.",
  confirmLabel: "Assign",
  risk: "sensitive",
  allowed: (ctx) => need(ctx, "tickets.assign"),
  fields: [
    { name: "ticket", label: "Ticket", type: "ref", ref: "ticket", required: true, editable: false },
    { name: "assignee", label: "Give to", type: "ref", ref: "user", refFilter: "dept:tech", required: true, help: "A member of the Tech department." },
  ],
  label: (v) => str(v.__name),
  minutesSaved: 1,
  async check(v, ctx) {
    const problems: Problem[] = [];
    const t = await ticketOf(ctx, v.ticket);
    if (t && !canTransition(t.status, "Assigned")) problems.push({ field: "ticket", message: `Only an Open or Assigned ticket can be assigned — this one is ${t.status}.` });
    if (typeof v.assignee === "string" && !(await isTech(ctx, v.assignee))) problems.push({ field: "assignee", message: "Tickets can only be assigned to Tech department members." });
    if (t && typeof v.assignee === "string" && t.assigned_to === v.assignee) problems.push({ field: "assignee", message: "The ticket is already assigned to them." });
    return {
      problems,
      values: t ? { __name: ticketName(t), __assigned_to: t.assigned_to ?? "", __assignee_name: await personName(ctx, v.assignee) } : {},
    };
  },
  async preview(v, ctx) {
    const t = await ticketOf(ctx, v.ticket);
    const [from, to] = await Promise.all([personName(ctx, t?.assigned_to), personName(ctx, v.assignee)]);
    const changes: CardChange[] = [{ label: "Assigned to", from: from || "—", to: to || "—" }];
    if (t?.status === "Open") changes.push({ label: "Status", from: "Open", to: "Assigned" });
    return {
      title: `Assign ${str(v.__name) || "the ticket"} to ${to}`,
      fields: [],
      changes,
      notes: [`${to || "They"} ${to ? "is" : "are"} notified.`],
      link: t ? ticketLink(t.id) : null,
      before: t ? { status: t.status, assigned_to: t.assigned_to, updated_at: t.updated_at } : null,
    };
  },
  async stale(before, v, ctx) {
    return movedOn(before, await ticketOf(ctx, v.ticket));
  },
  async execute(v) {
    const id = str(v.ticket);
    await callRoute(ticketRoute, "PATCH", { path: `/api/tickets/${id}`, params: { id }, body: { action: "assign", assigned_to: v.assignee } });
    // There is no "unassign": only a reassignment can be undone.
    return { message: `Assigned ${str(v.__name) || "the ticket"} to ${str(v.__assignee_name) || "them"}.`, link: ticketLink(id), data: { id }, undoable: Boolean(v.__assigned_to) };
  },
  undo: {
    async run(stored) {
      const before = (stored.before_state ?? {}) as { assigned_to?: string | null };
      if (!before.assigned_to) throw new Error("It had nobody before, and a ticket cannot be unassigned — reassign it instead.");
      const id = str(stored.input.ticket);
      await callRoute(ticketRoute, "PATCH", { path: `/api/tickets/${id}`, params: { id }, body: { action: "assign", assigned_to: before.assigned_to } });
      return "it is back with its previous assignee.";
    },
  },
};

/* ----------------------------------------------------------- ticket.work */

const ticketWork: ActionDef = {
  key: "ticket.work",
  group: "Tickets",
  title: "Work a ticket",
  description:
    "Start work on a ticket (Assigned → In Progress) and/or tick its changes done (or untick them). Name the changes by their text or number, or \"all\". Ticking the last change of an In Progress ticket resolves it automatically.",
  confirmLabel: "Save",
  risk: "standard",
  allowed: (ctx) => need(ctx, "tickets.resolve"),
  fields: [
    { name: "ticket", label: "Ticket", type: "ref", ref: "ticket", required: true, editable: false },
    { name: "done", label: "Tick as done", type: "list", max: 50, help: "Changes to tick: their text (or a part only one has), their number (1 = the first), or \"all\". Pass a list." },
    { name: "not_done", label: "Untick", type: "list", max: 50, help: "Changes to mark not done again, named the same way." },
    { name: "start", label: "Start work", type: "boolean", help: "Move an Assigned ticket to In Progress. Default: yes when it is Assigned and you may start it." },
  ],
  label: (v) => str(v.__name),
  minutesSaved: 1,
  async check(v, ctx) {
    const t = await ticketOf(ctx, v.ticket);
    if (!t) return {};
    const problems: Problem[] = [];
    const warnings: string[] = [];
    const items = await itemsOf(ctx, t.id);
    const done = pickItems(asList(v.done), items, "done");
    const undone = pickItems(asList(v.not_done), items, "not_done");
    problems.push(...done.problems, ...undone.problems);
    if (done.ids.some((id) => undone.ids.includes(id))) problems.push({ field: "not_done", message: "A change cannot be ticked and unticked at once." });
    const isDone = new Map(items.map((i) => [i.id, i.is_done]));
    const tick = done.ids.filter((id) => !isDone.get(id));
    const untick = undone.ids.filter((id) => isDone.get(id));
    if (tick.length < done.ids.length && !asList(v.done).some((n) => /^all$/i.test(n.trim()))) warnings.push(`${plural(done.ids.length - tick.length, "change")} named ${done.ids.length - tick.length === 1 ? "is" : "are"} already done.`);
    if (untick.length < undone.ids.length && !asList(v.not_done).some((n) => /^all$/i.test(n.trim()))) warnings.push(`${plural(undone.ids.length - untick.length, "change")} named ${undone.ids.length - untick.length === 1 ? "is" : "are"} not done anyway.`);

    // Starting: the endpoint lets the assignee — or someone who assigns tickets — start an Assigned ticket.
    const mayStart = t.assigned_to === ctx.userId || ctx.perms.has("tickets.assign");
    let start = false;
    if (v.start === true) {
      if (t.status === "Assigned") {
        if (mayStart) start = true;
        else problems.push({ field: "start", message: "Only the ticket's assignee (or someone who assigns tickets) can start it." });
      } else if (t.status === "Open") problems.push({ field: "start", message: "The ticket is not assigned yet — assign it first." });
      else if (t.status === "Resolved") problems.push({ field: "start", message: "The ticket is resolved — reopen it first." });
    } else if (v.start === undefined && t.status === "Assigned" && mayStart && (tick.length || untick.length)) {
      // Working a ticket starts it — as sending it to the AI developer does.
      start = true;
    }
    if (!start && !tick.length && !untick.length && !problems.length) {
      problems.push({ field: "_", message: t.status === "In Progress" && v.start === true ? "It is already in progress — say which changes to tick." : "Say which changes to tick (or untick), or to start the ticket." });
    }
    return { problems, warnings, values: { __name: ticketName(t, items), __status: t.status, __start: start, __tick: tick, __untick: untick } };
  },
  async preview(v, ctx) {
    const t = await ticketOf(ctx, v.ticket);
    const items = t ? await itemsOf(ctx, t.id) : [];
    const tick = asList(v.__tick);
    const untick = asList(v.__untick);
    const label = (id: string) => {
      const i = items.findIndex((x) => x.id === id);
      return i < 0 ? "A change" : `${i + 1}. ${items[i].body}`.slice(0, 120);
    };
    const changes: CardChange[] = [];
    if (v.__start === true) changes.push({ label: "Status", from: "Assigned", to: "In Progress" });
    for (const id of tick) changes.push({ label: label(id), from: "Not done", to: "Done" });
    for (const id of untick) changes.push({ label: label(id), from: "Done", to: "Not done" });
    const statusAfter = v.__start === true ? "In Progress" : t?.status;
    const allDone = items.length > 0 && items.every((it) => (it.is_done || tick.includes(it.id)) && !untick.includes(it.id));
    const notes: string[] = [];
    if (tick.length && statusAfter === "In Progress" && allDone) notes.push("That ticks the last change: the ticket is resolved automatically, and its creator and the lead's agent are told.");
    if (v.__start === true) notes.push("Starting cannot be undone here (Undo puts the ticks back).");
    const what = [v.__start === true ? "start" : "", tick.length ? `tick ${plural(tick.length, "change")}` : "", untick.length ? `untick ${plural(untick.length, "change")}` : ""].filter(Boolean).join(", ") || "work on";
    return {
      title: `${what.charAt(0).toUpperCase()}${what.slice(1)} — ${str(v.__name) || "the ticket"}`,
      fields: [],
      changes,
      notes,
      link: t ? ticketLink(t.id) : null,
      before: t ? { status: t.status, updated_at: t.updated_at, items: Object.fromEntries(items.map((i) => [i.id, i.is_done])) } : null,
    };
  },
  async stale(before, v, ctx) {
    const b = (before ?? {}) as { status?: string; items?: Record<string, boolean> };
    const t = await ticketOf(ctx, v.ticket);
    if (!t) return "the ticket no longer exists (or you can no longer see it).";
    if (b.status && t.status !== b.status) return `its status changed to ${t.status} in the meantime.`;
    const items = await itemsOf(ctx, t.id);
    const moved = items.some((i) => b.items && i.id in b.items && b.items[i.id] !== i.is_done);
    return moved ? "its changes were ticked or unticked by someone else in the meantime." : null;
  },
  async execute(v, ctx) {
    const id = str(v.ticket);
    let started = false;
    if (v.__start === true) {
      await callRoute(ticketRoute, "PATCH", { path: `/api/tickets/${id}`, params: { id }, body: { action: "start" } });
      started = true;
    }
    const done: string[] = [];
    const notDone: string[] = [];
    let failed = 0;
    let firstError: unknown = null;
    const toggles: [string, boolean][] = [...asList(v.__tick).map((i): [string, boolean] => [i, true]), ...asList(v.__untick).map((i): [string, boolean] => [i, false])];
    for (const [itemId, isDone] of toggles) {
      try {
        await callRoute(itemRoute, "PATCH", { path: `/api/tickets/${id}/items/${itemId}`, params: { id, itemId }, body: { is_done: isDone } });
        (isDone ? done : notDone).push(itemId);
      } catch (e) {
        failed++;
        firstError ??= e;
      }
    }
    if (firstError && !started && !done.length && !notDone.length) throw firstError;
    // Ticking the last change may have resolved it (the endpoint does that itself).
    const { data: now } = await ctx.admin.from("lead_tickets").select("status").eq("id", id).maybeSingle();
    const resolved = (now as { status?: string } | null)?.status === "Resolved" && v.__status !== "Resolved";
    const parts = [started ? "started it" : "", done.length ? `ticked ${plural(done.length, "change")}` : "", notDone.length ? `unticked ${plural(notDone.length, "change")}` : ""].filter(Boolean);
    return {
      message: `${str(v.__name)}: ${parts.join(", ")}${resolved ? " — that resolved the ticket" : ""}${failed ? ` (${failed} could not be changed)` : ""}.`,
      link: ticketLink(id),
      data: { id, started, done, not_done: notDone, resolved },
      undoable: done.length + notDone.length > 0,
    };
  },
  undo: {
    async run(stored, ctx) {
      const d = stored.result?.data ?? {};
      const id = str(d.id);
      if (d.resolved === true) {
        // Back to In Progress first, by the reopen rule (its creator, or
        // someone who assigns tickets). If that is refused, nothing changes.
        const { data: t } = await ctx.admin.from("lead_tickets").select("status").eq("id", id).maybeSingle();
        if ((t as { status?: string } | null)?.status === "Resolved") await callRoute(ticketRoute, "PATCH", { path: `/api/tickets/${id}`, params: { id }, body: { action: "reopen" } });
      }
      for (const itemId of asList(d.done)) await callRoute(itemRoute, "PATCH", { path: `/api/tickets/${id}/items/${itemId}`, params: { id, itemId }, body: { is_done: false } });
      for (const itemId of asList(d.not_done)) await callRoute(itemRoute, "PATCH", { path: `/api/tickets/${id}/items/${itemId}`, params: { id, itemId }, body: { is_done: true } });
      return `the changes are ticked as they were${d.resolved === true ? " and the ticket is open again" : ""}${d.started === true ? " (it stays In Progress)" : ""}.`;
    },
  },
};

/* -------------------------------------------------------- ticket.resolve */

const ticketResolve: ActionDef = {
  key: "ticket.resolve",
  group: "Tickets",
  title: "Resolve a ticket",
  description: "Close an In Progress ticket with a resolution note saying what was done. Its creator and the lead's agent are notified.",
  confirmLabel: "Resolve",
  risk: "standard",
  allowed: (ctx) => need(ctx, "tickets.resolve"),
  fields: [
    { name: "ticket", label: "Ticket", type: "ref", ref: "ticket", required: true, editable: false },
    { name: "resolution_note", label: "Resolution note", type: "longtext", required: true, max: 4000, help: "What was done — the creator and the lead's agent read it." },
  ],
  label: (v) => str(v.__name),
  minutesSaved: 1,
  async check(v, ctx) {
    const t = await ticketOf(ctx, v.ticket);
    if (!t) return {};
    const problems: Problem[] = [];
    const warnings: string[] = [];
    if (t.status !== "In Progress") {
      const why =
        t.status === "Resolved" ? "It is already resolved." : t.status === "Assigned" ? "Work has not started on it — start it first." : "It is not assigned yet — assign it and start it first.";
      problems.push({ field: "ticket", message: why });
    }
    const items = await itemsOf(ctx, t.id);
    const open = items.filter((i) => !i.is_done).length;
    if (open) warnings.push(`${open} of its ${plural(items.length, "change")} ${open === 1 ? "is" : "are"} not ticked done.`);
    // The ticket screen's nudge: resolving a website ticket with no files
    // uploaded during its life is usually a forgotten upload.
    if (leadOf(t)?.website_link) {
      const { data: proof } = await ctx.admin.from("activity_log").select("id").eq("entity_type", "ticket").eq("entity_id", t.id).eq("action", "studio.site.files_overridden").limit(1);
      if (!(proof ?? []).length) warnings.push("No updated website files were uploaded for this ticket — if the fix changed the site, upload them first, or the live site still runs the old files.");
    }
    return { problems, warnings, values: { __name: ticketName(t, items), __can_reopen: t.created_by === ctx.userId || ctx.perms.has("tickets.assign") } };
  },
  async preview(v, ctx) {
    const t = await ticketOf(ctx, v.ticket);
    return {
      title: `Resolve ${str(v.__name) || "the ticket"}`,
      changes: [{ label: "Status", from: t?.status ?? "In Progress", to: "Resolved" }],
      notes: ["Its creator and the lead's agent are told it is resolved."],
      link: t ? ticketLink(t.id) : null,
      before: t ? { status: t.status, updated_at: t.updated_at } : null,
    };
  },
  async stale(before, v, ctx) {
    return movedOn(before, await ticketOf(ctx, v.ticket));
  },
  async execute(v) {
    const id = str(v.ticket);
    await callRoute(ticketRoute, "PATCH", { path: `/api/tickets/${id}`, params: { id }, body: { action: "resolve", resolution_note: str(v.resolution_note).trim() } });
    // Undo reopens it — which only its creator, or someone who assigns tickets, may do.
    return { message: `Resolved ${str(v.__name) || "the ticket"}.`, link: ticketLink(id), data: { id }, undoable: v.__can_reopen === true };
  },
  undo: {
    async run(stored) {
      const id = str(stored.input.ticket);
      await callRoute(ticketRoute, "PATCH", { path: `/api/tickets/${id}`, params: { id }, body: { action: "reopen" } });
      return "it is In Progress again.";
    },
  },
};

/* --------------------------------------------------------- ticket.reopen */

const ticketReopen: ActionDef = {
  key: "ticket.reopen",
  group: "Tickets",
  title: "Reopen a ticket",
  description: "Put a Resolved ticket back In Progress (its creator, or someone who assigns tickets, may). Its assignee is notified.",
  confirmLabel: "Reopen",
  risk: "standard",
  // The endpoint's rule depends on the ticket (its creator, or tickets.assign): see check.
  allowed: () => null,
  fields: [{ name: "ticket", label: "Ticket", type: "ref", ref: "ticket", required: true, editable: false }],
  label: (v) => str(v.__name),
  minutesSaved: 1,
  async check(v, ctx) {
    const t = await ticketOf(ctx, v.ticket);
    if (!t) return {};
    const problems: Problem[] = [];
    if (t.status !== "Resolved") problems.push({ field: "ticket", message: `It is not resolved (it is ${t.status}).` });
    if (t.created_by !== ctx.userId && !ctx.perms.has("tickets.assign")) {
      problems.push({ field: "ticket", message: "Only the person who opened the ticket, or someone who assigns tickets, can reopen it." });
    }
    return { problems, values: { __name: ticketName(t), __can_resolve: ctx.perms.has("tickets.resolve") } };
  },
  async preview(v, ctx) {
    const t = await ticketOf(ctx, v.ticket);
    return {
      title: `Reopen ${str(v.__name) || "the ticket"}`,
      fields: [],
      changes: [{ label: "Status", from: "Resolved", to: "In Progress" }],
      notes: ["Its assignee is told it is reopened."],
      link: t ? ticketLink(t.id) : null,
      before: t ? { status: t.status, updated_at: t.updated_at, resolution_note: t.resolution_note } : null,
    };
  },
  async stale(before, v, ctx) {
    return movedOn(before, await ticketOf(ctx, v.ticket));
  },
  async execute(v) {
    const id = str(v.ticket);
    await callRoute(ticketRoute, "PATCH", { path: `/api/tickets/${id}`, params: { id }, body: { action: "reopen" } });
    // Undo resolves it again — which needs tickets.resolve.
    return { message: `Reopened ${str(v.__name) || "the ticket"}.`, link: ticketLink(id), data: { id }, undoable: v.__can_resolve === true };
  },
  undo: {
    async run(stored) {
      const before = (stored.before_state ?? {}) as { resolution_note?: string | null };
      const id = str(stored.input.ticket);
      const note = before.resolution_note?.trim() || "Resolved again (the reopen was undone).";
      await callRoute(ticketRoute, "PATCH", { path: `/api/tickets/${id}`, params: { id }, body: { action: "resolve", resolution_note: note } });
      return "it is resolved again.";
    },
  },
};

export const TICKET_ACTIONS: ActionDef[] = [ticketCreate, ticketAssign, ticketWork, ticketResolve, ticketReopen];
