// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * SED AI's ticket actions: the endpoints' permission and status rules said up
 * front, the New ticket form's multipart request (screenshots included),
 * changes named by their text, and undo through the same endpoints.
 */

const routes = vi.hoisted(() => ({ ticketsPost: vi.fn(), ticketPatch: vi.fn(), itemPatch: vi.fn() }));
vi.mock("@/app/api/leads/[id]/tickets/route", () => ({ POST: routes.ticketsPost }));
vi.mock("@/app/api/tickets/[id]/route", () => ({ PATCH: routes.ticketPatch }));
vi.mock("@/app/api/tickets/[id]/items/[itemId]/route", () => ({ PATCH: routes.itemPatch }));
vi.mock("@/lib/assistant/uploads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assistant/uploads")>();
  const rows: Record<string, { id: string; name: string; mime: string; size_bytes: number }> = {
    "77777777-7777-4777-8777-777777777701": { id: "77777777-7777-4777-8777-777777777701", name: "header.png", mime: "image/png", size_bytes: 2048 },
    "77777777-7777-4777-8777-777777777702": { id: "77777777-7777-4777-8777-777777777702", name: "footer.jpg", mime: "image/jpeg", size_bytes: 4096 },
    "77777777-7777-4777-8777-777777777703": { id: "77777777-7777-4777-8777-777777777703", name: "brief.pdf", mime: "application/pdf", size_bytes: 4096 },
  };
  return {
    ...actual,
    getUpload: vi.fn(async (_admin: unknown, _user: string, id: string) => rows[id] ?? null),
    readUpload: vi.fn(async (_admin: unknown, _user: string, id: string) => ({ row: rows[id], blob: new Blob([`bytes of ${rows[id].name}`], { type: rows[id].mime }) })),
  };
});

import { imageSlots, pickItems, TICKET_ACTIONS, type ItemRow } from "@/lib/assistant/actions/defs/tickets";
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
        or: () => b,
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
const DRAFT_LEAD = "44444444-4444-4444-8444-444444444442";
const T1 = "55555555-5555-4555-8555-555555555551";
const I1 = "66666666-6666-4666-8666-666666666661";
const I2 = "66666666-6666-4666-8666-666666666662";
const I3 = "66666666-6666-4666-8666-666666666663";
const UP_PNG = "77777777-7777-4777-8777-777777777701";
const UP_JPG = "77777777-7777-4777-8777-777777777702";
const UP_PDF = "77777777-7777-4777-8777-777777777703";
const NOW = new Date("2026-10-14T10:00:00Z");

const ticket = (over: Row = {}): Row => ({
  id: T1,
  title: "Fix the header",
  status: "Assigned",
  lead_id: LEAD,
  created_by: SARA,
  assigned_to: ME,
  updated_at: "2026-10-14T08:00:00+00:00",
  resolution_note: null,
  leads: { business_name: "Jumbo's Pizza", website_link: "https://jumbos.com" },
  ...over,
});

const items = (): Row[] => [
  { id: I1, ticket_id: T1, body: "Change the logo", is_done: false, sort: 0 },
  { id: I2, ticket_id: T1, body: "Update phone number in footer", is_done: false, sort: 1 },
  { id: I3, ticket_id: T1, body: "Update phone number in header", is_done: true, sort: 2 },
];

function setup(perms: string[], over: Record<string, Row[]> = {}) {
  const db = fakeDb({
    profiles: [
      { id: ME, display_name: "Me", email: "me@sed.test", is_active: true },
      { id: SARA, display_name: "Sara", email: "sara@sed.test", is_active: true },
      { id: ALI, display_name: "Ali", email: "ali@sed.test", is_active: true },
    ],
    leads: [
      { id: LEAD, business_name: "Jumbo's Pizza", status: "Ready", agent_id: ME, business_phone: null, deleted_at: null },
      { id: DRAFT_LEAD, business_name: "Draft Diner", status: "Not Ready", agent_id: ME, business_phone: null, deleted_at: null },
    ],
    lead_tickets: [ticket()],
    ticket_items: items(),
    departments: [{ id: "d-tech", slug: "tech" }],
    department_members: [{ department_id: "d-tech", user_id: ALI }],
    app_settings: [{ singleton: true, ticket_sla: { Low: 100, Normal: 48, High: 12 } }],
    assistant_uploads: [UP_PNG, UP_JPG, UP_PDF].map((id) => ({ id, user_id: ME, name: id, mime: "image/png", size_bytes: 1 })),
    activity_log: [],
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

const def = (key: string): ActionDef => TICKET_ACTIONS.find((d) => d.key === key)!;
const create = def("ticket.create");
const assign = def("ticket.assign");
const work = def("ticket.work");
const resolve = def("ticket.resolve");
const reopen = def("ticket.reopen");

/** normalize → check, the way prepare does it. */
async function prepared(d: ActionDef, raw: Values, ctx: ActionContext) {
  const n = await normalizeFields(d, raw, ctx);
  const missing = missingFields(d, n.values, n.problems).map((f) => f.name);
  const checked = (await d.check?.(n.values, ctx)) ?? {};
  Object.assign(n.values, checked.values ?? {});
  return { values: n.values, missing, problems: [...n.problems, ...(checked.problems ?? [])], warnings: checked.warnings ?? [] };
}

const stored = (d: ActionDef, input: Values, before: unknown, result: StoredAction["result"]): StoredAction =>
  ({ id: "act-1", user_id: ME, action_key: d.key, input, before_state: before, result }) as unknown as StoredAction;

const jsonOf = async (fn: ReturnType<typeof vi.fn>, i: number) => {
  const req = fn.mock.calls[i][0] as Request;
  return { path: new URL(req.url).pathname, body: (await req.json()) as Record<string, unknown> };
};

beforeEach(() => {
  routes.ticketsPost.mockReset().mockImplementation(async () => Response.json({ ticket: { id: "88888888-8888-4888-8888-888888888888" } }, { status: 201 }));
  routes.ticketPatch.mockReset().mockImplementation(async () => Response.json({ ticket: {} }));
  routes.itemPatch.mockReset().mockImplementation(async () => Response.json({ item: {} }));
});

describe("who may use them (the endpoints' own permission checks)", () => {
  it("maps each action to its permission", () => {
    const nobody = setup([]).ctx;
    expect(create.allowed(nobody)).toBe("Your account doesn't have “Open Tickets”.");
    expect(assign.allowed(nobody)).toBe("Your account doesn't have “Assign Tickets”.");
    expect(work.allowed(nobody)).toBe("Your account doesn't have “Resolve Tickets”.");
    expect(resolve.allowed(nobody)).toBe("Your account doesn't have “Resolve Tickets”.");
    // Reopening depends on the ticket (its creator, or tickets.assign): decided in check.
    expect(reopen.allowed(nobody)).toBeNull();
    expect(create.allowed(setup(["tickets.create"]).ctx)).toBeNull();
  });
});

describe("ticket.create", () => {
  it("asks for the type, who requested it and the changes; priority defaults to Normal", async () => {
    const { ctx } = setup(["tickets.create"]);
    const n = await prepared(create, { lead: "Jumbo's Pizza" }, ctx);
    expect(n.values.lead).toBe(LEAD);
    expect(n.values.priority).toBe("Normal");
    expect(n.missing).toEqual(["category", "signature", "items"]);
  });

  it("refuses a lead the endpoint refuses, and files it cannot attach", async () => {
    const { ctx } = setup(["tickets.create"]);
    const draft = await prepared(create, { lead: DRAFT_LEAD, category: "Changes", signature: "Agent", items: ["Logo"] }, ctx);
    expect(draft.problems).toEqual([{ field: "lead", message: "Tickets apply only to Ready, Long Term, or Closed leads — Draft Diner is Not Ready." }]);
    const pdf = await prepared(create, { lead: LEAD, category: "Changes", signature: "Agent", items: ["Logo"], images: [`upload:${UP_PDF}`] }, ctx);
    expect(pdf.problems).toEqual([{ field: "images", message: "brief.pdf is not an image — tickets take images only." }]);
    const link = await prepared(create, { lead: LEAD, category: "Changes", signature: "Agent", items: ["Logo"], images: ["https://example.com/a.png"] }, ctx);
    expect(link.problems[0].message).toContain("must be attached in this chat");
    const mapping = await prepared(create, { lead: LEAD, category: "Changes", signature: "Agent", items: ["Logo"], images: [`upload:${UP_PNG}`], image_items: [2] }, ctx);
    expect(mapping.problems).toEqual([{ field: "image_items", message: "Each number must be one of the ticket's changes, 1 to 1." }]);
  });

  it("maps screenshots to changes (default: the first), at most five per change", () => {
    expect(imageSlots(undefined, 2, 3)).toEqual({ slots: [0, 0] });
    expect(imageSlots([1, "#3"], 2, 3)).toEqual({ slots: [0, 2] });
    expect(imageSlots("2, 2", 2, 3)).toEqual({ slots: [1, 1] });
    expect(imageSlots([1], 2, 3)).toEqual({ problem: "Give one change number per screenshot: 2 screenshots, 1 number." });
    expect(imageSlots(undefined, 6, 1)).toEqual({ problem: "At most 5 screenshots per change — say which change each one shows." });
  });

  it("sends the New ticket form's multipart request, screenshots as item_<n> files", async () => {
    const { ctx } = setup(["tickets.create"]);
    const n = await prepared(
      create,
      {
        lead: LEAD,
        category: "changes",
        signature: "Closer",
        items: ["Change the logo", "New footer phone"],
        priority: "High",
        images: [`upload:${UP_PNG}`, `upload:${UP_JPG}`],
        image_items: [1, 2],
      },
      ctx,
    );
    expect(n.missing).toEqual([]);
    expect(n.problems).toEqual([]);
    const p = await create.preview!(n.values, ctx);
    expect(p.title).toBe("Open a ticket on Jumbo's Pizza: Change the logo");
    expect(p.notes).toContain("Screenshots: 1 screenshot with change 1, 1 screenshot with change 2.");

    const res = await create.execute(n.values, ctx, { actionId: "a", origin: "" });
    const req = routes.ticketsPost.mock.calls[0][0] as Request;
    expect(new URL(req.url).pathname).toBe(`/api/leads/${LEAD}/tickets`);
    const form = await req.formData();
    expect(JSON.parse(String(form.get("payload")))).toEqual({
      category: "Changes",
      signature: "Closer",
      priority: "High",
      title: null,
      // No due date given: the High deadline from the settings (12 h), as the form fills it in.
      due_date: "2026-10-14T22:00:00.000Z",
      items: ["Change the logo", "New footer phone"],
    });
    const first = form.get("item_0") as File;
    const second = form.get("item_1") as File;
    expect([first.name, first.type, await first.text()]).toEqual(["header.png", "image/png", "bytes of header.png"]);
    expect([second.name, second.type]).toEqual(["footer.jpg", "image/jpeg"]);
    expect(res.data).toEqual({ id: "88888888-8888-4888-8888-888888888888", kind: "ticket" });
    expect(res.link).toEqual({ href: "/tickets/88888888-8888-4888-8888-888888888888", label: "Open ticket" });
  });
});

describe("ticket.assign", () => {
  it("only to a Tech member, only from Open or Assigned", async () => {
    const { ctx } = setup(["tickets.assign"]);
    expect((await prepared(assign, { ticket: T1, assignee: SARA }, ctx)).problems).toEqual([
      { field: "assignee", message: "Tickets can only be assigned to Tech department members." },
    ]);
    expect((await prepared(assign, { ticket: T1, assignee: ME }, setup(["tickets.assign"], { department_members: [{ department_id: "d-tech", user_id: ME }] }).ctx)).problems).toEqual([
      { field: "assignee", message: "The ticket is already assigned to them." },
    ]);
    const resolved = setup(["tickets.assign"], { lead_tickets: [ticket({ status: "Resolved" })] }).ctx;
    expect((await prepared(assign, { ticket: T1, assignee: ALI }, resolved)).problems[0].message).toBe("Only an Open or Assigned ticket can be assigned — this one is Resolved.");
  });

  it("reassigns through PATCH /api/tickets/[id], and undo gives it back", async () => {
    const { ctx } = setup(["tickets.assign"]);
    const n = await prepared(assign, { ticket: T1, assignee: ALI }, ctx);
    expect(n.problems).toEqual([]);
    const p = await assign.preview!(n.values, ctx);
    expect(p.changes).toEqual([{ label: "Assigned to", from: "Me", to: "Ali" }]);
    const res = await assign.execute(n.values, ctx, { actionId: "a", origin: "" });
    expect(await jsonOf(routes.ticketPatch, 0)).toEqual({ path: `/api/tickets/${T1}`, body: { action: "assign", assigned_to: ALI } });
    expect(res.undoable).toBe(true);
    expect(await assign.undo!.run(stored(assign, n.values, p.before, res), ctx)).toBe("it is back with its previous assignee.");
    expect((await jsonOf(routes.ticketPatch, 1)).body).toEqual({ action: "assign", assigned_to: ME });
  });

  it("cannot undo a first assignment (there is no unassign)", async () => {
    const { ctx } = setup(["tickets.assign"], { lead_tickets: [ticket({ status: "Open", assigned_to: null })] });
    const n = await prepared(assign, { ticket: T1, assignee: ALI }, ctx);
    const p = await assign.preview!(n.values, ctx);
    expect(p.changes).toEqual([
      { label: "Assigned to", from: "—", to: "Ali" },
      { label: "Status", from: "Open", to: "Assigned" },
    ]);
    expect((await assign.execute(n.values, ctx, { actionId: "a", origin: "" })).undoable).toBe(false);
  });
});

describe("ticket.work", () => {
  const list = items() as unknown as ItemRow[];

  it("finds changes by number, text, or a part only one has", () => {
    expect(pickItems(["1", "#2"], list, "done")).toEqual({ ids: [I1, I2], problems: [] });
    expect(pickItems(["change the LOGO", "in footer"], list, "done")).toEqual({ ids: [I1, I2], problems: [] });
    expect(pickItems(["all"], list, "done").ids).toEqual([I1, I2, I3]);
    const vague = pickItems(["update phone number"], list, "done");
    expect(vague.ids).toEqual([]);
    expect(vague.problems[0]).toEqual({
      field: "done",
      message: '"update phone number" matches 2 changes on this ticket — which one?',
      choices: ["2. Update phone number in footer", "3. Update phone number in header"],
    });
    expect(pickItems(["menu"], list, "done").problems[0].message).toBe('No change on this ticket matches "menu".');
  });

  it("starts an Assigned ticket of yours when you tick its changes, and says the last tick resolves it", async () => {
    const { ctx } = setup(["tickets.resolve"]);
    const n = await prepared(work, { ticket: T1, done: ["all"] }, ctx);
    expect(n.problems).toEqual([]);
    expect(n.warnings).toEqual([]);
    expect(n.values).toMatchObject({ __start: true, __tick: [I1, I2], __untick: [] });
    const p = await work.preview!(n.values, ctx);
    expect(p.title).toBe("Start, tick 2 changes — Fix the header (Jumbo's Pizza)");
    expect(p.changes).toEqual([
      { label: "Status", from: "Assigned", to: "In Progress" },
      { label: "1. Change the logo", from: "Not done", to: "Done" },
      { label: "2. Update phone number in footer", from: "Not done", to: "Done" },
    ]);
    expect(p.notes?.[0]).toContain("resolved automatically");
  });

  it("does not start someone else's ticket, and says what cannot be done", async () => {
    const other = setup(["tickets.resolve"], { lead_tickets: [ticket({ assigned_to: ALI })] }).ctx;
    expect((await prepared(work, { ticket: T1, done: ["1"] }, other)).values.__start).toBe(false);
    expect((await prepared(work, { ticket: T1, start: true }, other)).problems[0].message).toBe("Only the ticket's assignee (or someone who assigns tickets) can start it.");
    const open = setup(["tickets.resolve"], { lead_tickets: [ticket({ status: "Open", assigned_to: null })] }).ctx;
    expect((await prepared(work, { ticket: T1, start: true }, open)).problems[0].message).toBe("The ticket is not assigned yet — assign it first.");
    const busy = setup(["tickets.resolve"], { lead_tickets: [ticket({ status: "In Progress" })] }).ctx;
    expect((await prepared(work, { ticket: T1 }, busy)).problems).toEqual([{ field: "_", message: "Say which changes to tick (or untick), or to start the ticket." }]);
    const named = await prepared(work, { ticket: T1, done: ["3"], not_done: ["1"] }, busy);
    expect(named.warnings).toEqual(["1 change named is already done.", "1 change named is not done anyway."]);
  });

  it("starts, then ticks, through the ticket endpoints; undo reopens what it resolved and unticks", async () => {
    const { ctx, db } = setup(["tickets.resolve"]);
    const n = await prepared(work, { ticket: T1, done: ["1", "2"] }, ctx);
    const p = await work.preview!(n.values, ctx);
    // The item endpoint resolves the ticket when its last change is ticked.
    routes.itemPatch.mockImplementation(async () => {
      db.tables.lead_tickets[0].status = "Resolved";
      return Response.json({ item: {} });
    });
    const res = await work.execute(n.values, ctx, { actionId: "a", origin: "" });
    expect(await jsonOf(routes.ticketPatch, 0)).toEqual({ path: `/api/tickets/${T1}`, body: { action: "start" } });
    expect(await jsonOf(routes.itemPatch, 0)).toEqual({ path: `/api/tickets/${T1}/items/${I1}`, body: { is_done: true } });
    expect(await jsonOf(routes.itemPatch, 1)).toEqual({ path: `/api/tickets/${T1}/items/${I2}`, body: { is_done: true } });
    expect(res.message).toBe("Fix the header (Jumbo's Pizza): started it, ticked 2 changes — that resolved the ticket.");
    expect(res.data).toEqual({ id: T1, started: true, done: [I1, I2], not_done: [], resolved: true });

    routes.itemPatch.mockReset().mockImplementation(async () => Response.json({ item: {} }));
    const msg = await work.undo!.run(stored(work, n.values, p.before, res), ctx);
    expect(await jsonOf(routes.ticketPatch, 1)).toEqual({ path: `/api/tickets/${T1}`, body: { action: "reopen" } });
    expect((await jsonOf(routes.itemPatch, 0)).body).toEqual({ is_done: false });
    expect(msg).toBe("the changes are ticked as they were and the ticket is open again (it stays In Progress).");
  });

  it("refuses a stale card when the changes moved meanwhile", async () => {
    const { ctx, db } = setup(["tickets.resolve"]);
    const n = await prepared(work, { ticket: T1, done: ["1"] }, ctx);
    const p = await work.preview!(n.values, ctx);
    expect(await work.stale!(p.before, n.values, ctx)).toBeNull();
    db.tables.ticket_items[1].is_done = true;
    expect(await work.stale!(p.before, n.values, ctx)).toBe("its changes were ticked or unticked by someone else in the meantime.");
  });
});

describe("ticket.resolve and ticket.reopen", () => {
  it("resolves only In Progress tickets, with the screen's warnings", async () => {
    expect((await prepared(resolve, { ticket: T1, resolution_note: "Done" }, setup(["tickets.resolve"]).ctx)).problems).toEqual([
      { field: "ticket", message: "Work has not started on it — start it first." },
    ]);
    const { ctx } = setup(["tickets.resolve"], { lead_tickets: [ticket({ status: "In Progress" })] });
    const n = await prepared(resolve, { ticket: T1, resolution_note: "Logo and footer updated" }, ctx);
    expect(n.problems).toEqual([]);
    expect(n.warnings).toEqual([
      "2 of its 3 changes are not ticked done.",
      "No updated website files were uploaded for this ticket — if the fix changed the site, upload them first, or the live site still runs the old files.",
    ]);
    const res = await resolve.execute(n.values, ctx, { actionId: "a", origin: "" });
    expect(await jsonOf(routes.ticketPatch, 0)).toEqual({ path: `/api/tickets/${T1}`, body: { action: "resolve", resolution_note: "Logo and footer updated" } });
    // Undo would reopen it, which only its creator or tickets.assign may do.
    expect(res.undoable).toBe(false);
    const assigner = setup(["tickets.resolve", "tickets.assign"], { lead_tickets: [ticket({ status: "In Progress" })] }).ctx;
    const again = await prepared(resolve, { ticket: T1, resolution_note: "Done" }, assigner);
    expect((await resolve.execute(again.values, assigner, { actionId: "a", origin: "" })).undoable).toBe(true);
    expect(await resolve.undo!.run(stored(resolve, again.values, null, { message: "" }), assigner)).toBe("it is In Progress again.");
    expect((await jsonOf(routes.ticketPatch, 2)).body).toEqual({ action: "reopen" });
  });

  it("reopens for its creator or an assigner, and undo resolves it again with the old note", async () => {
    const tables = { lead_tickets: [ticket({ status: "Resolved", resolution_note: "Logo swapped" })] };
    expect((await prepared(reopen, { ticket: T1 }, setup(["tickets.resolve"], tables).ctx)).problems).toEqual([
      { field: "ticket", message: "Only the person who opened the ticket, or someone who assigns tickets, can reopen it." },
    ]);
    const { ctx } = setup(["tickets.assign", "tickets.resolve", "tickets.view_all"], tables);
    const n = await prepared(reopen, { ticket: T1 }, ctx);
    expect(n.problems).toEqual([]);
    const p = await reopen.preview!(n.values, ctx);
    const res = await reopen.execute(n.values, ctx, { actionId: "a", origin: "" });
    expect((await jsonOf(routes.ticketPatch, 0)).body).toEqual({ action: "reopen" });
    expect(res.undoable).toBe(true);
    await reopen.undo!.run(stored(reopen, n.values, p.before, res), ctx);
    expect((await jsonOf(routes.ticketPatch, 1)).body).toEqual({ action: "resolve", resolution_note: "Logo swapped" });
  });
});
