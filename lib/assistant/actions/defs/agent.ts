import { AGENT_SPEED_ORDER, AGENT_SPEEDS, MAX_TIME_LIMIT_MIN, MIN_TIME_LIMIT_MIN, type AgentSpeed } from "@/lib/site-agent/options";
import { AGENT_RUN_ACTIVE_STATUSES } from "@/lib/site-agent/types";
import { workerStatus } from "@/lib/site-agent/workerStatus";
import { siteHostFrom } from "@/lib/site-studio/deploy/liveFiles";
import { isProtectedDomain } from "@/lib/site-studio/deploy/protected";
import { subFromWebsiteLink } from "@/lib/template-engine/directadmin";
import { allowedTicketScope, canActOnTicket } from "@/lib/tickets/scope";
import type { CardLink } from "../card";
import { isStepRef, need, str, visibleLead } from "../helpers";
import { callRoute } from "../invoke";
import type { ActionContext, ActionDef, CheckResult, FieldSpec, Problem, Values } from "../types";
import { itemsOf, pickItems } from "./tickets";

/**
 * AI developer actions: send it work (a ticket, or a written task on a lead's
 * website), send a result back with changes, discard a run, and publish a
 * reviewed result to the live site. Every one goes through the endpoints the
 * AI developer panel uses (see ../invoke.ts), so their permission and ticket
 * scope rules (lib/site-agent/access.ts) apply unchanged.
 */

const ticketRunsRoute = () => import("@/app/api/tickets/[id]/agent-runs/route");
const leadRunsRoute = () => import("@/app/api/leads/[id]/agent-runs/route");
const reviseRoute = () => import("@/app/api/site-agent/runs/[id]/revise/route");
const discardRoute = () => import("@/app/api/site-agent/runs/[id]/discard/route");
const approveRoute = () => import("@/app/api/site-agent/runs/[id]/approve/route");
const snapshotsRoute = () => import("@/app/api/site-studio/deployments/snapshots/route");
const restoreRoute = () => import("@/app/api/site-studio/deployments/restore/route");

/* -------------------------------------------------------------- helpers */

/** Every AI developer endpoint admits studio.manage or tickets.resolve. */
const mayUseAgent = (ctx: ActionContext) => (ctx.perms.has("studio.manage") || ctx.perms.has("tickets.resolve") ? null : need(ctx, "tickets.resolve"));

type LeadJoin = { business_name?: string; website_link?: string | null } | { business_name?: string; website_link?: string | null }[] | null;
const joined = (l: LeadJoin) => (Array.isArray(l) ? l[0] : l) ?? null;

interface RunRow {
  id: string;
  status: string;
  ticket_id: string | null;
  lead_id: string | null;
  site_host: string;
  files: Record<string, { action?: string }> | null;
  summary: string | null;
  updated_at: string;
  leads: LeadJoin;
}

/** A run, read as the AI developer endpoints read it (service role). */
async function runOf(ctx: ActionContext, id: unknown): Promise<RunRow | null> {
  if (typeof id !== "string" || isStepRef(id)) return null;
  const { data } = await ctx.admin
    .from("site_agent_runs")
    .select("id, status, ticket_id, lead_id, site_host, files, summary, updated_at, leads(business_name)")
    .eq("id", id)
    .maybeSingle();
  return (data as RunRow | null) ?? null;
}

const runName = (r: RunRow) => joined(r.leads)?.business_name || r.site_host;
const runLink = (r: { ticket_id: string | null; lead_id: string | null }): CardLink | null =>
  r.ticket_id ? { href: `/tickets/${r.ticket_id}`, label: "Open ticket" } : r.lead_id ? { href: `/leads/${r.lead_id}`, label: "Open lead" } : null;

/**
 * lib/site-agent/access.ts's object rule: a run on a ticket needs that ticket
 * within the person's reach (canActOnTicket); studio.manage reaches every run,
 * and a ticketless run needs no more than the permission.
 */
async function outOfReach(ctx: ActionContext, run: RunRow): Promise<string | null> {
  if (ctx.perms.has("studio.manage") || !run.ticket_id) return null;
  const { data: ticket } = await ctx.admin.from("lead_tickets").select("id, created_by, lead_id, assigned_to").eq("id", run.ticket_id).maybeSingle();
  if (!ticket) return "That run's ticket is gone — only Site Studio managers can act on it.";
  const scope = await allowedTicketScope(ctx.admin, ctx.userId, ctx.perms);
  return canActOnTicket(ticket as { created_by: string | null; lead_id: string; assigned_to: string | null }, ctx.userId, scope) ? null : "That run is on a ticket you cannot act on.";
}

/** The run field's checks shared by revise, discard and approve. */
async function checkRun(v: Values, ctx: ActionContext, ok: (run: RunRow) => string | null): Promise<{ run: RunRow | null; problems: Problem[] }> {
  const run = await runOf(ctx, v.run);
  if (!run) return { run: null, problems: [] };
  const problems: Problem[] = [];
  const status = ok(run);
  if (status) problems.push({ field: "run", message: status });
  const reach = await outOfReach(ctx, run);
  if (reach) problems.push({ field: "run", message: reach });
  return { run, problems };
}

/** Has the run moved on since the card was drawn? A run in review sits still, so any write to it counts. */
async function runMovedOn(before: unknown, v: Values, ctx: ActionContext, exact: boolean): Promise<string | null> {
  const b = (before ?? {}) as { status?: string; updated_at?: string };
  const run = await runOf(ctx, v.run);
  if (!run) return "the run no longer exists.";
  if (b.status && run.status !== b.status) return `the run is ${run.status} now.`;
  if (exact && b.updated_at && run.updated_at !== b.updated_at) return "the run changed after this was proposed (sent back or retried).";
  return null;
}

/** The create endpoints' site rule: a website link with a host, never our own infrastructure (staging subdomains are client sites). */
function siteProblem(link: string | null | undefined): string | null {
  const host = link ? siteHostFrom(link) : null;
  if (!host) return "This lead has no website link — nothing to edit.";
  if (!subFromWebsiteLink(link, process.env.DA_DOMAIN ?? "") && isProtectedDomain(host)) return "That host is protected infrastructure.";
  return null;
}

/** An AI run still in flight (one per ticket; one ticketless run per lead). */
async function inFlight(ctx: ActionContext, where: { ticket: string } | { lead: string }): Promise<boolean> {
  const q = ctx.admin.from("site_agent_runs").select("id").in("status", [...AGENT_RUN_ACTIVE_STATUSES]);
  const { data } = await ("ticket" in where ? q.eq("ticket_id", where.ticket) : q.eq("lead_id", where.lead).is("ticket_id", null)).limit(1);
  return Boolean((data ?? []).length);
}

/* The run controls a person would actually name: model, speed, time limit.
   Anything left out comes from the team's AI developer settings. */

const SPEED_LABELS = AGENT_SPEED_ORDER.map((s) => AGENT_SPEEDS[s].label);
const speedOf = (label: unknown): AgentSpeed | undefined => AGENT_SPEED_ORDER.find((s) => AGENT_SPEEDS[s].label === label);

/** The models the worker publishes, by their labels ("Gemini 3.8 Flash (High)"). */
async function modelLabels(ctx: ActionContext): Promise<string[]> {
  return (await workerStatus(ctx.admin)).models.map((m) => m.label);
}

const controlFields: FieldSpec[] = [
  { name: "model", label: "Model", type: "enum", options: modelLabels, help: "Only when the person names one. Default: the team's model." },
  {
    name: "speed",
    label: "Speed",
    type: "enum",
    options: SPEED_LABELS,
    help: "Only when the person says: Quick (small edits — text, colours, images, links), Balanced (most requests) or Thorough (big or site-wide changes). Default: the team's.",
  },
  { name: "time_limit", label: "Time limit (minutes)", type: "integer", min: MIN_TIME_LIMIT_MIN, max: MAX_TIME_LIMIT_MIN, help: "Only when the person says. Default: the speed's own." },
];

/** The model's id (the endpoints take ids) and whether the worker is up. */
async function checkControls(v: Values, ctx: ActionContext): Promise<{ values: Values; warnings: string[] }> {
  const status = await workerStatus(ctx.admin);
  const values: Values = {};
  if (typeof v.model === "string") values.__model = status.models.find((m) => m.label === v.model)?.id ?? null;
  return { values, warnings: status.workerOnline ? [] : ["The AI developer's worker is offline — the run waits in the queue until it is back."] };
}

/**
 * `model` and `options` as the endpoints take them. A follow-up keeps the
 * run's own time limit unless told otherwise, so a new speed brings its own
 * limit with it (as the panel does); a new run gets the speed's limit anyway.
 */
function controlBody(v: Values, followUp: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof v.__model === "string") out.model = v.__model;
  const options: Record<string, unknown> = {};
  const speed = speedOf(v.speed);
  if (speed) options.speed = speed;
  if (typeof v.time_limit === "number") options.time_limit_min = v.time_limit;
  else if (speed && followUp) options.time_limit_min = AGENT_SPEEDS[speed].minutes;
  if (Object.keys(options).length) out.options = options;
  return out;
}

const runField: FieldSpec = {
  name: "run",
  label: "AI run",
  type: "ref",
  ref: "agent_run",
  required: true,
  editable: false,
  help: "The AI developer's run, by the lead's name or the website (pick the one in the right state).",
};

/* ------------------------------------------------------------ agent.send */

const agentSend: ActionDef = {
  key: "agent.send",
  group: "AI developer",
  title: "Send work to the AI developer",
  description:
    "Have the AI developer make changes on a client's live website — from a ticket (Assigned or In Progress: its open changes, or only some of them) or, without a ticket, from a written task on a lead. It works on a copy; nothing goes live until someone approves the result (agent.approve). Model, speed and time limit only when the person names them.",
  confirmLabel: "Send to AI developer",
  risk: "standard",
  allowed: mayUseAgent,
  fields: [
    { name: "ticket", label: "Ticket", type: "ref", ref: "ticket", editable: false, help: "The ticket whose changes the AI developer makes. Give this, or a lead." },
    {
      name: "lead",
      label: "Lead",
      type: "ref",
      ref: "lead",
      editable: false,
      required: (v) => !v.ticket,
      showIf: (v) => !v.ticket,
      help: "Without a ticket: the lead whose website the AI developer edits.",
    },
    {
      name: "items",
      label: "Only these changes",
      type: "list",
      max: 50,
      showIf: (v) => Boolean(v.ticket),
      help: "With a ticket: send only some of its open changes (their text or number). Default: every open change.",
    },
    {
      name: "task",
      label: "Task",
      type: "longtext",
      max: 4000,
      required: (v) => !v.ticket,
      help: "What to change on the website, in plain words. Required without a ticket; with a ticket it replaces the task written from its changes (leave it out to use them).",
    },
    ...controlFields,
  ],
  label: (v) => str(v.__name),
  produces: "agent_run",
  minutesSaved: 3,
  async check(v, ctx): Promise<CheckResult> {
    const problems: Problem[] = [];
    const values: Values = {};
    if (typeof v.ticket === "string" && !isStepRef(v.ticket)) {
      const { data } = await ctx.admin.from("lead_tickets").select("id, title, status, leads(business_name, website_link)").eq("id", v.ticket).maybeSingle();
      const t = data as { id: string; title: string | null; status: string; leads: LeadJoin } | null;
      if (t) {
        const lead = joined(t.leads);
        values.__name = `${t.title?.trim() || "Ticket"}${lead?.business_name ? ` (${lead.business_name})` : ""}`;
        values.__status = t.status;
        if (t.status !== "Assigned" && t.status !== "In Progress") {
          problems.push({ field: "ticket", message: t.status === "Resolved" ? "The ticket is Resolved — reopen it first." : `The ticket is "${t.status}" — assign it first.` });
        }
        const site = siteProblem(lead?.website_link);
        if (site) problems.push({ field: "ticket", message: site });
        else values.__host = siteHostFrom(lead!.website_link!);
        if (await inFlight(ctx, { ticket: t.id })) problems.push({ field: "ticket", message: "An AI run is already in flight for this ticket." });
        // Only some changes: they must be open ones; all of them is the whole ticket.
        const names = (Array.isArray(v.items) ? (v.items as string[]) : []).filter((n) => !/^all$/i.test(n.trim()));
        if (names.length) {
          const all = await itemsOf(ctx, t.id);
          const open = all.filter((i) => !i.is_done);
          const picked = pickItems(names, all, "items");
          problems.push(...picked.problems);
          const done = picked.ids.filter((id) => !open.some((i) => i.id === id));
          if (done.length) problems.push({ field: "items", message: `${all.find((i) => i.id === done[0])?.body.slice(0, 60) ?? "That change"} is already done — only open changes can be sent.` });
          values.__item_ids = picked.ids.length === open.length ? null : picked.ids;
        }
      }
    } else if (typeof v.lead === "string" && !isStepRef(v.lead)) {
      const lead = await visibleLead<{ business_name: string; website_link: string | null }>(ctx, v.lead, "business_name, website_link");
      if (!lead) problems.push({ field: "lead", message: "That lead is not visible to you." });
      else {
        values.__name = lead.business_name;
        const site = siteProblem(lead.website_link);
        if (site) problems.push({ field: "lead", message: site });
        else values.__host = siteHostFrom(lead.website_link!);
        if (await inFlight(ctx, { lead: v.lead })) problems.push({ field: "lead", message: "An AI run is already in flight for this lead." });
      }
    }
    const controls = await checkControls(v, ctx);
    return { problems, warnings: controls.warnings, values: { ...values, ...controls.values } };
  },
  async preview(v) {
    const host = str(v.__host) || "the website";
    const notes = [`It works on a copy of ${host}: nothing changes on the live website until you approve its result.`];
    if (v.ticket && v.__status === "Assigned") notes.push("The ticket moves to In Progress.");
    if (v.model === undefined || v.speed === undefined || v.time_limit === undefined) notes.push("Anything not set here comes from the team's AI developer settings.");
    const ticketId = typeof v.ticket === "string" && !isStepRef(v.ticket) ? v.ticket : null;
    const leadId = typeof v.lead === "string" && !isStepRef(v.lead) ? v.lead : null;
    return {
      title: v.ticket ? `Send ${str(v.__name) || "the ticket"} to the AI developer` : `AI developer: edit ${str(v.__name) || "the lead"}'s website`,
      notes,
      link: runLink({ ticket_id: ticketId, lead_id: leadId }),
    };
  },
  async execute(v) {
    const body = controlBody(v, false);
    const task = str(v.task).trim();
    let res: { run?: { id: string; site_host?: string } };
    if (typeof v.ticket === "string") {
      if (Array.isArray(v.__item_ids)) body.item_ids = v.__item_ids;
      if (task) body.task_text = task;
      res = await callRoute(ticketRunsRoute, "POST", { path: `/api/tickets/${v.ticket}/agent-runs`, params: { id: v.ticket }, body });
    } else {
      body.task_text = task;
      res = await callRoute(leadRunsRoute, "POST", { path: `/api/leads/${v.lead}/agent-runs`, params: { id: str(v.lead) }, body });
    }
    const id = str(res.run?.id);
    const host = res.run?.site_host || str(v.__host);
    return {
      message: `Sent to the AI developer — it is working on a copy of ${host}. Review its changes before anything goes live.`,
      link: runLink({ ticket_id: typeof v.ticket === "string" ? v.ticket : null, lead_id: typeof v.lead === "string" ? v.lead : null }),
      data: { id, kind: "agent_run", ticket_started: Boolean(v.ticket) && v.__status === "Assigned" },
    };
  },
  undo: {
    async run(stored) {
      const id = str(stored.result?.data?.id);
      if (!id) throw new Error("Nothing to undo.");
      // Cancelling a queued or running job (or throwing its result away): the live site was never touched.
      await callRoute(discardRoute, "POST", { path: `/api/site-agent/runs/${id}/discard`, params: { id } });
      return `the AI run was cancelled${stored.result?.data?.ticket_started === true ? " (the ticket stays In Progress)" : ""}.`;
    },
  },
};

/* ---------------------------------------------------------- agent.revise */

const agentRevise: ActionDef = {
  key: "agent.revise",
  group: "AI developer",
  title: "Request changes on an AI run",
  description:
    "Send an AI developer result that is waiting for review back with instructions for what to change; it continues from its last result and comes back for review. Optionally a different model, speed or time limit.",
  confirmLabel: "Send back",
  risk: "standard",
  allowed: mayUseAgent,
  fields: [
    { ...runField, refFilter: "status:review" },
    { name: "instructions", label: "What to change", type: "longtext", required: true, max: 4000, help: "What the AI developer should change in its result, in plain words." },
    ...controlFields,
  ],
  label: (v) => str(v.__name),
  minutesSaved: 2,
  async check(v, ctx) {
    const { run, problems } = await checkRun(v, ctx, (r) => (r.status === "review" ? null : `This run is ${r.status} — only a run waiting for review can be sent back.`));
    const controls = await checkControls(v, ctx);
    return { problems, warnings: controls.warnings, values: { ...controls.values, ...(run ? { __name: runName(run), __host: run.site_host } : {}) } };
  },
  async preview(v, ctx) {
    const run = await runOf(ctx, v.run);
    return {
      title: `Request changes — ${str(v.__name)} (${str(v.__host)})`,
      notes: ["The AI developer continues from its last result; you review it again before anything goes live."],
      link: run ? runLink(run) : null,
      before: run ? { status: run.status, updated_at: run.updated_at } : null,
    };
  },
  async stale(before, v, ctx) {
    return runMovedOn(before, v, ctx, true);
  },
  async execute(v) {
    const id = str(v.run);
    await callRoute(reviseRoute, "POST", { path: `/api/site-agent/runs/${id}/revise`, params: { id }, body: { instructions: str(v.instructions).trim(), ...controlBody(v, true) } });
    return { message: `Sent ${str(v.__name)} back to the AI developer with your changes.`, data: { id } };
  },
};

/* --------------------------------------------------------- agent.discard */

/** The discard endpoint's escape hatch: a deploy stuck this long is not live any more. */
const DEPLOYING_STALE_MS = 10 * 60_000;

const agentDiscard: ActionDef = {
  key: "agent.discard",
  group: "AI developer",
  title: "Cancel or discard an AI run",
  description:
    "Stop an AI developer run that is queued or running, or throw away a result waiting for review (nothing reaches the live site). Also clears a deploy that has been stuck for over 10 minutes.",
  confirmLabel: "Discard",
  // Throwing a finished result away loses the work; stopping a job does not.
  risk: (v) => (v.__status === "review" ? "sensitive" : "standard"),
  allowed: mayUseAgent,
  fields: [{ ...runField, refFilter: "status:queued|running|review", help: "The run to stop (queued or running) or whose result to throw away (in review), by the lead's name or the website." }],
  label: (v) => str(v.__name),
  minutesSaved: 1,
  async check(v, ctx) {
    const { run, problems } = await checkRun(v, ctx, (r) => {
      if (["queued", "running", "review"].includes(r.status)) return null;
      if (r.status === "deploying") return ctx.now.getTime() - Date.parse(r.updated_at) > DEPLOYING_STALE_MS ? null : "A deploy is in progress — wait for it to finish.";
      return `It is ${r.status} — there is nothing to discard.`;
    });
    return { problems, values: run ? { __name: runName(run), __host: run.site_host, __status: run.status } : {} };
  },
  async preview(v, ctx) {
    const run = await runOf(ctx, v.run);
    const name = str(v.__name);
    const title =
      v.__status === "review" ? `Discard the AI developer's changes for ${name}` : v.__status === "deploying" ? `Clear the stuck deploy for ${name}` : `Stop the AI run for ${name}`;
    const warnings =
      v.__status === "review"
        ? ["Its edited result is thrown away (the live site was never touched)."]
        : v.__status === "deploying"
          ? ["This deploy has been stuck for a while — if it actually finished, the website is already updated."]
          : [];
    return { title, warnings, notes: ["This cannot be undone."], link: run ? runLink(run) : null, before: run ? { status: run.status, updated_at: run.updated_at } : null };
  },
  async stale(before, v, ctx) {
    // A running job writes progress all the time: only its status counts.
    return runMovedOn(before, v, ctx, false);
  },
  async execute(v) {
    const id = str(v.run);
    await callRoute(discardRoute, "POST", { path: `/api/site-agent/runs/${id}/discard`, params: { id } });
    return { message: v.__status === "review" ? `Discarded the AI developer's changes for ${str(v.__name)}.` : `Stopped the AI run for ${str(v.__name)}.`, data: { id } };
  },
};

/* --------------------------------------------------------- agent.approve */

/** Snapshot files are named by their ISO time with ":" and "." made "-" (snapshotName in lib/site-studio/deploy/snapshots.ts). */
const snapshotStamp = (iso: string) => iso.replace(/[:.]/g, "-");

const agentApprove: ActionDef = {
  key: "agent.approve",
  group: "AI developer",
  title: "Approve an AI run",
  description:
    "Publish an AI developer result that is waiting for review to the client's LIVE website (a snapshot of the site is taken first). On a ticket, the changes it covered are ticked done. The person should have looked at the preview.",
  confirmLabel: "Publish to live site",
  risk: "critical",
  allowed: mayUseAgent,
  fields: [{ ...runField, refFilter: "status:review", help: "The run waiting for review, by the lead's name or the website." }],
  label: (v) => str(v.__host),
  minutesSaved: 2,
  async check(v, ctx) {
    const { run, problems } = await checkRun(v, ctx, (r) => (r.status === "review" ? null : `This run is ${r.status} — only a run waiting for review can be published.`));
    return { problems, values: run ? { __name: runName(run), __host: run.site_host, __ticket: run.ticket_id ?? "" } : {} };
  },
  async preview(v, ctx) {
    const run = await runOf(ctx, v.run);
    const host = run?.site_host ?? str(v.__host);
    const files = Object.entries(run?.files ?? {});
    const listed = files.slice(0, 8).map(([path, change]) => `${path} (${change.action ?? "edit"})`);
    const notes = [
      run?.summary ? `What it changed: ${run.summary.slice(0, 400)}` : "",
      files.length ? `Files: ${listed.join(", ")}${files.length > 8 ? ` and ${files.length - 8} more` : ""}.` : "",
      "A snapshot of the live site is taken first — Undo (or the Deployments board) puts it back.",
      run?.ticket_id ? "The ticket's changes this run covered are ticked done; if that completes the ticket, it is resolved." : "",
    ].filter(Boolean);
    return {
      title: `Publish the AI developer's changes to ${host}`,
      warnings: [`This goes live on ${host} straight away.`],
      notes,
      // Check the result before publishing it.
      link: run ? { href: `/api/site-agent/runs/${run.id}/preview/`, label: "Preview the changes" } : null,
      confirmPhrase: host,
      before: run ? { status: run.status, updated_at: run.updated_at } : null,
    };
  },
  async stale(before, v, ctx) {
    // A result sent back and redone since the card was drawn is not the one that was previewed.
    return runMovedOn(before, v, ctx, true);
  },
  async execute(v) {
    const id = str(v.run);
    const from = new Date().toISOString();
    const res = await callRoute<{ ok?: boolean; url?: string }>(approveRoute, "POST", { path: `/api/site-agent/runs/${id}/approve`, params: { id } });
    const to = new Date().toISOString();
    const url = res.url ?? `https://${str(v.__host)}`;
    return { message: `Published the changes to ${url}.`, link: { href: url, label: "Open the website" }, data: { id, site: str(v.__host), from, to, ticket: str(v.__ticket) || null } };
  },
  undo: {
    minutes: 10,
    async run(stored) {
      const d = stored.result?.data ?? {};
      const site = str(d.site);
      if (!site || typeof d.from !== "string" || typeof d.to !== "string") throw new Error("Nothing to undo.");
      // The endpoint snapshots the live site just before it publishes: that is the way back.
      const listed = await callRoute<{ snapshots?: { path: string; name: string }[] }>(snapshotsRoute, "GET", { path: "/api/site-studio/deployments/snapshots", search: { site } });
      const snapshots = listed.snapshots ?? [];
      const lo = snapshotStamp(d.from);
      const hi = snapshotStamp(d.to);
      const stamp = (name: string) => name.replace(/\.zip$/, "");
      const mine = snapshots.find((s) => stamp(s.name) >= lo && stamp(s.name) <= hi);
      if (!mine) throw new Error("No snapshot was saved before this deploy, so it cannot be undone here.");
      // Every later upload or restore snapshots the site first — a newer one means it changed again since.
      if (snapshots.some((s) => stamp(s.name) > hi)) throw new Error("The website was changed again after this deploy — restore a snapshot from the Deployments board instead.");
      await callRoute(restoreRoute, "POST", { path: "/api/site-studio/deployments/restore", search: { site }, body: { path: mine.path } });
      return `the website's previous files are back${d.ticket ? " (the ticket's changes stay ticked done)" : ""}.`;
    },
  },
};

export const AGENT_ACTIONS: ActionDef[] = [agentSend, agentRevise, agentDiscard, agentApprove];
