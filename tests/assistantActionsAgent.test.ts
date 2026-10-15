// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * SED AI's AI developer actions: the run endpoints' permission and ticket
 * scope rules (lib/site-agent/access.ts) and status rules said up front, the
 * request bodies the panel would send, the stale checks that keep a card from
 * publishing a result nobody previewed, and undo for a live deploy (put the
 * snapshot the deploy took back).
 */

const routes = vi.hoisted(() => ({
  ticketRuns: vi.fn(),
  leadRuns: vi.fn(),
  revise: vi.fn(),
  discard: vi.fn(),
  approve: vi.fn(),
  snapshots: vi.fn(),
  restore: vi.fn(),
}));
vi.mock("@/app/api/tickets/[id]/agent-runs/route", () => ({ POST: routes.ticketRuns }));
vi.mock("@/app/api/leads/[id]/agent-runs/route", () => ({ POST: routes.leadRuns }));
vi.mock("@/app/api/site-agent/runs/[id]/revise/route", () => ({ POST: routes.revise }));
vi.mock("@/app/api/site-agent/runs/[id]/discard/route", () => ({ POST: routes.discard }));
vi.mock("@/app/api/site-agent/runs/[id]/approve/route", () => ({ POST: routes.approve }));
vi.mock("@/app/api/site-studio/deployments/snapshots/route", () => ({ GET: routes.snapshots }));
vi.mock("@/app/api/site-studio/deployments/restore/route", () => ({ POST: routes.restore }));

import { AGENT_ACTIONS } from "@/lib/assistant/actions/defs/agent";
import { missingFields, normalizeFields } from "@/lib/assistant/actions/fields";
import type { ActionContext, ActionDef, StoredAction, Values } from "@/lib/assistant/actions/types";

type Row = Record<string, unknown>;

/** A chainable stand-in for supabase-js over fixture rows (fresh copies, like a real client). */
function fakeDb(tables: Record<string, Row[]>) {
  const client = {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let single = false;
      let limit: number | null = null;
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        order: () => b,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
        neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), b),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
        ilike: (c: string, p: string) => (filters.push((r) => String(r[c] ?? "").toLowerCase().includes(p.replace(/%/g, "").toLowerCase())), b),
        limit: (n: number) => ((limit = n), b),
        maybeSingle: () => ((single = true), b),
        single: () => ((single = true), b),
        then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
          const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
          const out = (limit === null ? rows : rows.slice(0, limit)).map((r) => ({ ...r }));
          return Promise.resolve(single ? { data: out[0] ?? null, error: null } : { data: out, error: null }).then(resolve, reject);
        },
      });
      return b;
    },
  };
  return { client: client as unknown as SupabaseClient, tables };
}

const ME = "11111111-1111-4111-8111-111111111111";
const SARA = "22222222-2222-4222-8222-222222222222";
const ALI = "33333333-3333-4333-8333-333333333333";
const LEAD = "44444444-4444-4444-8444-444444444441";
const BARE_LEAD = "44444444-4444-4444-8444-444444444442";
const OTHER_LEAD = "44444444-4444-4444-8444-444444444443";
const T1 = "55555555-5555-4555-8555-555555555551";
const T_OPEN = "55555555-5555-4555-8555-555555555552";
const T_OTHER = "55555555-5555-4555-8555-555555555553";
const I1 = "66666666-6666-4666-8666-666666666661";
const I2 = "66666666-6666-4666-8666-666666666662";
const I3 = "66666666-6666-4666-8666-666666666663";
const R1 = "99999999-9999-4999-8999-999999999991";
const R_OTHER = "99999999-9999-4999-8999-999999999992";
const NOW = new Date("2026-10-14T10:00:00Z");

const jumbos = { business_name: "Jumbo's Pizza", website_link: "https://jumbos.com" };
const run = (over: Row = {}): Row => ({
  id: R1,
  status: "review",
  ticket_id: T1,
  lead_id: LEAD,
  site_host: "jumbos.com",
  files: { "index.html": { action: "edit", bytes: 900 }, "menu.html": { action: "create", bytes: 400 } },
  summary: "Swapped the logo and fixed the footer phone.",
  created_by: ME,
  created_at: "2026-10-14T09:00:00+00:00",
  updated_at: "2026-10-14T09:40:00+00:00",
  leads: { business_name: "Jumbo's Pizza" },
  ...over,
});

function setup(perms: string[], over: Record<string, Row[]> = {}, seenAt = new Date().toISOString()) {
  const db = fakeDb({
    profiles: [{ id: ME, display_name: "Me", email: "me@sed.test", is_active: true }],
    leads: [
      { id: LEAD, ...jumbos, status: "Ready", agent_id: ME, business_phone: null, deleted_at: null },
      { id: BARE_LEAD, business_name: "Bare Bakery", website_link: null, status: "Ready", agent_id: ME, business_phone: null, deleted_at: null },
      { id: OTHER_LEAD, business_name: "Other Co", website_link: "https://other.co", status: "Ready", agent_id: SARA, business_phone: null, deleted_at: null },
    ],
    lead_tickets: [
      { id: T1, title: "Fix the header", status: "Assigned", lead_id: LEAD, created_by: SARA, assigned_to: ME, leads: jumbos },
      { id: T_OPEN, title: "New menu", status: "Open", lead_id: LEAD, created_by: SARA, assigned_to: null, leads: jumbos },
      { id: T_OTHER, title: "Other fix", status: "In Progress", lead_id: OTHER_LEAD, created_by: SARA, assigned_to: ALI, leads: { business_name: "Other Co", website_link: "https://other.co" } },
    ],
    ticket_items: [
      { id: I1, ticket_id: T1, body: "Change the logo", is_done: false, sort: 0 },
      { id: I2, ticket_id: T1, body: "Fix the footer phone", is_done: false, sort: 1 },
      { id: I3, ticket_id: T1, body: "Add a menu link", is_done: true, sort: 2 },
    ],
    site_agent_runs: [],
    app_settings: [
      {
        singleton: true,
        agent_worker_seen_at: seenAt,
        agent_worker_models: { models: [{ id: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)" }, { id: "gemini-3.8-pro", label: "Gemini 3.8 Pro" }] },
      },
    ],
    ...over,
  });
  const ctx: ActionContext = {
    userId: ME,
    displayName: "Me",
    perms: new Set(perms),
    db: db.client,
    admin: db.client,
    timezone: "Asia/Karachi",
    now: NOW,
    isAdmin: false,
  };
  return { ctx, db };
}

const def = (key: string): ActionDef => AGENT_ACTIONS.find((d) => d.key === key)!;
const send = def("agent.send");
const revise = def("agent.revise");
const discard = def("agent.discard");
const approve = def("agent.approve");
const TECH = ["tickets.resolve", "tickets.view"];

async function prepared(d: ActionDef, raw: Values, ctx: ActionContext) {
  const n = await normalizeFields(d, raw, ctx);
  const missing = missingFields(d, n.values, n.problems).map((f) => f.name);
  const checked = (await d.check?.(n.values, ctx)) ?? {};
  Object.assign(n.values, checked.values ?? {});
  return { values: n.values, missing, problems: [...n.problems, ...(checked.problems ?? [])], warnings: checked.warnings ?? [] };
}

const riskOf = (d: ActionDef, v: Values) => (typeof d.risk === "function" ? d.risk(v) : d.risk);
const jsonOf = async (fn: ReturnType<typeof vi.fn>, i = 0) => {
  const req = fn.mock.calls[i][0] as Request;
  const text = await req.text();
  return { url: new URL(req.url), body: (text ? JSON.parse(text) : null) as Record<string, unknown> | null };
};

const env = { ...process.env };
beforeEach(() => {
  for (const fn of Object.values(routes)) fn.mockReset();
  routes.ticketRuns.mockImplementation(async () => Response.json({ run: { id: R1, site_host: "jumbos.com" } }, { status: 201 }));
  routes.leadRuns.mockImplementation(async () => Response.json({ run: { id: R1, site_host: "jumbos.com" } }, { status: 201 }));
  routes.revise.mockImplementation(async () => Response.json({ ok: true }));
  routes.discard.mockImplementation(async () => Response.json({ ok: true }));
  routes.approve.mockImplementation(async () => Response.json({ ok: true, url: "https://jumbos.com" }));
  routes.restore.mockImplementation(async () => Response.json({ ok: true }));
});
afterEach(() => {
  process.env = { ...env };
});

describe("who may use them (every AI developer endpoint's gate)", () => {
  it("needs Resolve Tickets or Site Studio", () => {
    for (const d of AGENT_ACTIONS) {
      expect(d.allowed(setup([]).ctx)).toBe("Your account doesn't have “Resolve Tickets”.");
      expect(d.allowed(setup(["tickets.resolve"]).ctx)).toBeNull();
      expect(d.allowed(setup(["studio.manage"]).ctx)).toBeNull();
    }
  });
});

describe("agent.send", () => {
  it("needs a ticket, or a lead and a task", async () => {
    const { ctx } = setup(TECH);
    expect((await prepared(send, {}, ctx)).missing).toEqual(["lead", "task"]);
    expect((await prepared(send, { ticket: T1 }, ctx)).missing).toEqual([]);
    expect((await prepared(send, { lead: LEAD }, ctx)).missing).toEqual(["task"]);
  });

  it("says what the create endpoints would refuse", async () => {
    const { ctx } = setup(TECH);
    expect((await prepared(send, { ticket: T_OPEN }, ctx)).problems).toEqual([{ field: "ticket", message: 'The ticket is "Open" — assign it first.' }]);
    expect((await prepared(send, { lead: BARE_LEAD, task: "New hero photo" }, ctx)).problems).toEqual([
      { field: "lead", message: "This lead has no website link — nothing to edit." },
    ]);
    process.env.PROTECTED_DOMAINS = "jumbos.com";
    expect((await prepared(send, { lead: LEAD, task: "New hero photo" }, ctx)).problems).toEqual([{ field: "lead", message: "That host is protected infrastructure." }]);
    const busy = setup(TECH, { site_agent_runs: [run({ status: "running" })] }).ctx;
    process.env.PROTECTED_DOMAINS = "";
    expect((await prepared(send, { ticket: T1 }, busy)).problems).toEqual([{ field: "ticket", message: "An AI run is already in flight for this ticket." }]);
  });

  it("edits our own staging subdomains even though the staging apex is protected", async () => {
    process.env.DA_DOMAIN = "dmviral.com";
    const staging = { ...jumbos, website_link: "https://jumbos.dmviral.com" };
    const { ctx } = setup(TECH, {
      leads: [{ id: LEAD, ...staging, status: "Ready", agent_id: ME, deleted_at: null }],
    });
    const n = await prepared(send, { lead: LEAD, task: "New hero photo" }, ctx);
    expect(n.problems).toEqual([]);
    expect(n.values.__host).toBe("jumbos.dmviral.com");
  });

  it("sends only the open changes named — or the whole ticket — with the controls the person set", async () => {
    const { ctx } = setup(TECH);
    const some = await prepared(send, { ticket: T1, items: ["logo"], model: "gemini 3.8 pro", speed: "quick" }, ctx);
    expect(some.problems).toEqual([]);
    expect(some.values).toMatchObject({ __item_ids: [I1], __model: "gemini-3.8-pro", __host: "jumbos.com", __status: "Assigned" });
    expect((await prepared(send, { ticket: T1, items: ["1", "2"] }, ctx)).values.__item_ids).toBeNull();
    expect((await prepared(send, { ticket: T1, items: ["all"] }, ctx)).values.__item_ids).toBeUndefined();
    expect((await prepared(send, { ticket: T1, items: ["3"] }, ctx)).problems).toEqual([
      { field: "items", message: "Add a menu link is already done — only open changes can be sent." },
    ]);

    const p = await send.preview!(some.values, ctx);
    expect(p.title).toBe("Send Fix the header (Jumbo's Pizza) to the AI developer");
    expect(p.notes).toContain("The ticket moves to In Progress.");

    const res = await send.execute(some.values, ctx, { actionId: "a", origin: "" });
    const call = await jsonOf(routes.ticketRuns);
    expect(call.url.pathname).toBe(`/api/tickets/${T1}/agent-runs`);
    expect(call.body).toEqual({ model: "gemini-3.8-pro", options: { speed: "quick" }, item_ids: [I1] });
    expect(res.data).toEqual({ id: R1, kind: "agent_run", ticket_started: true });

    const msg = await send.undo!.run({ result: res, input: some.values } as unknown as StoredAction, ctx);
    expect((await jsonOf(routes.discard)).url.pathname).toBe(`/api/site-agent/runs/${R1}/discard`);
    expect(msg).toBe("the AI run was cancelled (the ticket stays In Progress).");
  });

  it("sends a written task on a lead's site through the lead endpoint, and warns when the worker is away", async () => {
    const { ctx } = setup(TECH, {}, "2026-10-01T00:00:00Z");
    const n = await prepared(send, { lead: "Jumbo's", task: "  Make the phone number bigger  ", time_limit: 20 }, ctx);
    expect(n.problems).toEqual([]);
    expect(n.warnings).toEqual(["The AI developer's worker is offline — the run waits in the queue until it is back."]);
    await send.execute(n.values, ctx, { actionId: "a", origin: "" });
    const call = await jsonOf(routes.leadRuns);
    expect(call.url.pathname).toBe(`/api/leads/${LEAD}/agent-runs`);
    expect(call.body).toEqual({ options: { time_limit_min: 20 }, task_text: "Make the phone number bigger" });
  });
});

describe("agent.revise", () => {
  it("only for a run in review, and only on a ticket within reach", async () => {
    const tables = { site_agent_runs: [run({ status: "running" }), run({ id: R_OTHER, ticket_id: T_OTHER, lead_id: OTHER_LEAD, site_host: "other.co", leads: { business_name: "Other Co" } })] };
    const { ctx } = setup(TECH, tables);
    expect((await prepared(revise, { run: R1, instructions: "Bigger logo" }, ctx)).problems).toEqual([
      { field: "run", message: "This run is running — only a run waiting for review can be sent back." },
    ]);
    // A tech without View All, not on that ticket: the endpoint's scope rule hides it…
    expect((await prepared(revise, { run: R_OTHER, instructions: "Bigger logo" }, ctx)).problems).toEqual([{ field: "run", message: "No AI developer run with that id is visible to you." }]);
    // …while Site Studio reaches every run.
    expect((await prepared(revise, { run: R_OTHER, instructions: "Bigger logo" }, setup(["studio.manage"], tables).ctx)).problems).toEqual([]);
  });

  it("sends the instructions, and a new speed brings its own time limit", async () => {
    const { ctx } = setup(TECH, { site_agent_runs: [run()] });
    const n = await prepared(revise, { run: "jumbos.com", instructions: " Make the logo bigger ", speed: "Thorough", model: "Gemini 3.8 Flash (High)" }, ctx);
    expect(n.problems).toEqual([]);
    expect(n.values.run).toBe(R1);
    await revise.execute(n.values, ctx, { actionId: "a", origin: "" });
    const call = await jsonOf(routes.revise);
    expect(call.url.pathname).toBe(`/api/site-agent/runs/${R1}/revise`);
    expect(call.body).toEqual({ instructions: "Make the logo bigger", model: "gemini-3.8-flash-high", options: { speed: "thorough", time_limit_min: 30 } });
  });
});

describe("agent.discard", () => {
  it("stopping a job is standard; throwing a reviewed result away is sensitive", async () => {
    const running = await prepared(discard, { run: R1 }, setup(TECH, { site_agent_runs: [run({ status: "running" })] }).ctx);
    expect(running.problems).toEqual([]);
    expect(riskOf(discard, running.values)).toBe("standard");
    const review = await prepared(discard, { run: R1 }, setup(TECH, { site_agent_runs: [run()] }).ctx);
    expect(riskOf(discard, review.values)).toBe("sensitive");
    const deploying = setup(TECH, { site_agent_runs: [run({ status: "deploying", updated_at: "2026-10-14T09:55:00Z" })] }).ctx;
    expect((await prepared(discard, { run: R1 }, deploying)).problems).toEqual([{ field: "run", message: "A deploy is in progress — wait for it to finish." }]);
    const stuck = setup(TECH, { site_agent_runs: [run({ status: "deploying", updated_at: "2026-10-14T09:30:00Z" })] }).ctx;
    expect((await prepared(discard, { run: R1 }, stuck)).problems).toEqual([]);
    const done = setup(TECH, { site_agent_runs: [run({ status: "deployed" })] }).ctx;
    expect((await prepared(discard, { run: R1 }, done)).problems).toEqual([{ field: "run", message: "It is deployed — there is nothing to discard." }]);
  });

  it("does not call a running job stale for its progress writes, only for a new status", async () => {
    const { ctx, db } = setup(TECH, { site_agent_runs: [run({ status: "running" })] });
    const n = await prepared(discard, { run: R1 }, ctx);
    const p = await discard.preview!(n.values, ctx);
    expect(p.title).toBe("Stop the AI run for Jumbo's Pizza");
    db.tables.site_agent_runs[0].updated_at = "2026-10-14T09:59:00Z";
    expect(await discard.stale!(p.before, n.values, ctx)).toBeNull();
    db.tables.site_agent_runs[0].status = "review";
    expect(await discard.stale!(p.before, n.values, ctx)).toBe("the run is review now.");
    await discard.execute(n.values, ctx, { actionId: "a", origin: "" });
    expect((await jsonOf(routes.discard)).url.pathname).toBe(`/api/site-agent/runs/${R1}/discard`);
  });
});

describe("agent.approve", () => {
  it("is critical, confirmed with the site's host, with the preview to check first", async () => {
    const { ctx, db } = setup(TECH, { site_agent_runs: [run()] });
    const n = await prepared(approve, { run: R1 }, ctx);
    expect(n.problems).toEqual([]);
    expect(riskOf(approve, n.values)).toBe("critical");
    const p = await approve.preview!(n.values, ctx);
    expect(p.confirmPhrase).toBe("jumbos.com");
    expect(p.link).toEqual({ href: `/api/site-agent/runs/${R1}/preview/`, label: "Preview the changes" });
    expect(p.warnings).toEqual(["This goes live on jumbos.com straight away."]);
    expect(p.notes).toContain("Files: index.html (edit), menu.html (create).");
    // A result sent back and redone since the card appeared is not the one previewed.
    db.tables.site_agent_runs[0].updated_at = "2026-10-14T09:58:00Z";
    expect(await approve.stale!(p.before, n.values, ctx)).toBe("the run changed after this was proposed (sent back or retried).");
    expect((await prepared(approve, { run: R1 }, setup(TECH, { site_agent_runs: [run({ status: "queued" })] }).ctx)).problems).toEqual([
      { field: "run", message: "This run is queued — only a run waiting for review can be published." },
    ]);
  });

  it("publishes through the approve endpoint, and undo restores the snapshot that deploy took", async () => {
    const { ctx } = setup(TECH, { site_agent_runs: [run()] });
    const n = await prepared(approve, { run: R1 }, ctx);
    const res = await approve.execute(n.values, ctx, { actionId: "a", origin: "" });
    expect((await jsonOf(routes.approve)).url.pathname).toBe(`/api/site-agent/runs/${R1}/approve`);
    expect(res.message).toBe("Published the changes to https://jumbos.com.");
    expect(res.data).toMatchObject({ id: R1, site: "jumbos.com", ticket: T1 });

    const data = { ...res.data, from: "2026-10-14T10:00:00.000Z", to: "2026-10-14T10:00:40.000Z" };
    const snap = (name: string) => ({ name, path: `snapshots/jumbos.com/${name}` });
    routes.snapshots.mockImplementation(async () => Response.json({ snapshots: [snap("2026-10-14T10-00-12-345Z.zip"), snap("2026-10-12T08-00-00-000Z.zip")] }));
    const msg = await approve.undo!.run({ result: { message: "", data }, input: n.values } as unknown as StoredAction, ctx);
    expect((await jsonOf(routes.snapshots)).url.searchParams.get("site")).toBe("jumbos.com");
    const restore = await jsonOf(routes.restore);
    expect(restore.url.pathname).toBe("/api/site-studio/deployments/restore");
    expect(restore.url.searchParams.get("site")).toBe("jumbos.com");
    expect(restore.body).toEqual({ path: "snapshots/jumbos.com/2026-10-14T10-00-12-345Z.zip" });
    expect(msg).toBe("the website's previous files are back (the ticket's changes stay ticked done).");
  });

  it("will not undo over a later change, or without the deploy's snapshot", async () => {
    const { ctx } = setup(TECH);
    const data = { id: R1, site: "jumbos.com", from: "2026-10-14T10:00:00.000Z", to: "2026-10-14T10:00:40.000Z", ticket: null };
    const action = { result: { message: "", data }, input: {} } as unknown as StoredAction;
    const snap = (name: string) => ({ name, path: `snapshots/jumbos.com/${name}` });
    routes.snapshots.mockImplementation(async () => Response.json({ snapshots: [snap("2026-10-14T10-04-00-000Z.zip"), snap("2026-10-14T10-00-12-345Z.zip")] }));
    await expect(approve.undo!.run(action, ctx)).rejects.toThrow("The website was changed again after this deploy");
    routes.snapshots.mockImplementation(async () => Response.json({ snapshots: [snap("2026-10-12T08-00-00-000Z.zip")] }));
    await expect(approve.undo!.run(action, ctx)).rejects.toThrow("No snapshot was saved before this deploy");
    expect(routes.restore).not.toHaveBeenCalled();
  });
});
