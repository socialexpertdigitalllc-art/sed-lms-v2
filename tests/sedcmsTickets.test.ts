// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";
import { withEnv } from "./helpers/fakeSiteHosts";
import { SEDCMS_DEFAULTS, SEDCMS_UNIQUE, TEST_SECRET, leadPath, linkRow, routeCtx, signedRequest } from "./helpers/sedcmsRoutes";
import { isTicketEligible } from "@/lib/tickets/logic";

/**
 * POST /api/internal/sedcms/leads/{id}/tickets (launch plan L6): a client's
 * "Request a change" in SED CMS becomes a ticket on the lead — idempotent by
 * requestId, with the usual "ticket opened" notification. Unlike the staff
 * route, the lead's status isn't checked: a client asking for a change to
 * their own live site is always eligible.
 *
 * Idempotent on every process (the security review's M3): the request id is
 * claimed in sedcms_requests first, and the ticket, its items and its log row
 * have ids derived from it, so no failed write, crash or second process ever
 * makes a second ticket or a second notification, and a later delivery
 * completes one that stopped part-way.
 */

const state = vi.hoisted(() => ({
  db: null as MemoryDb | null,
  fromCalls: 0,
  notified: [] as Record<string, unknown>[],
  notifyFails: false,
  /** writes (insert or upsert) to fail, per table, before they work again */
  failWrites: {} as Record<string, number>,
  /** the next ticket insert waits for this */
  ticketGate: null as Promise<void> | null,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      state.fromCalls++;
      const q = state.db!.client.from(table) as unknown as Record<string | symbol, unknown>;
      return new Proxy(q, {
        get(target, prop) {
          if ((prop === "insert" || prop === "upsert") && (state.failWrites[table] ?? 0) > 0) {
            state.failWrites[table]--;
            return () => Promise.resolve({ data: null, error: { message: "canceling statement due to statement timeout" } });
          }
          if (prop === "insert" && table === "lead_tickets" && state.ticketGate) {
            const gate = state.ticketGate;
            state.ticketGate = null;
            return (...args: unknown[]) => gate.then(() => (target.insert as (...a: unknown[]) => unknown)(...args));
          }
          return target[prop];
        },
      });
    },
  }),
}));

vi.mock("@/lib/tickets/notify", () => ({
  notifyTicket: async (opts: Record<string, unknown>) => {
    state.notified.push(opts);
    if (state.notifyFails) throw new Error("push service down");
  },
}));

import { POST as ticketsPOST } from "@/app/api/internal/sedcms/leads/[id]/tickets/route";

const LEAD = "11111111-1111-4111-8111-111111111111";
const NOT_READY_LEAD = "22222222-2222-4222-8222-222222222222";
const DELETED_LEAD = "33333333-3333-4333-8333-333333333333";
const OTHER_LEAD = "44444444-4444-4444-8444-444444444444";
const REQUEST_ID = "5f0c2d1e-3b4a-4c5d-8e6f-7a8b9c0d1e2f";

const body = (overrides: Record<string, unknown> = {}) => ({
  requestId: REQUEST_ID,
  title: "Update the menu prices",
  items: ["Change the lunch special to $12", "  Keep the spaces as typed  ", "<script>alert(1)</script>"],
  requestedBy: { name: "Zoë Owner", email: "zoe@acme.example" },
  pageUrl: "https://acme-roofing.dmviral.com/menu.html",
  ...overrides,
});

const send = (id: string, b: unknown, opts = {}) => ticketsPOST(signedRequest(leadPath(id, "tickets"), b, opts), routeCtx(id));

let restoreEnv: () => void;

beforeEach(() => {
  restoreEnv = withEnv({ SEDCMS_LMS_SECRET: TEST_SECRET });
  const lead = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
    id,
    business_name: "Acme Roofing",
    business_email: "owner@acme.example",
    status,
    website_link: "https://acme-roofing.dmviral.com",
    deleted_at: null,
    ...extra,
  });
  state.db = memorySupabase({
    leads: [
      lead(LEAD, "Closed"),
      lead(NOT_READY_LEAD, "Not Ready"),
      lead(DELETED_LEAD, "Closed", { deleted_at: "2026-10-01T00:00:00Z" }),
      lead(OTHER_LEAD, "Ready", { business_name: "Other Co" }),
    ],
    lead_tickets: [],
    ticket_items: [],
    activity_log: [],
    // SED CMS is on for each (a ticket checks the link, not its host)
    sedcms_links: [
      linkRow(LEAD, "acme-roofing.dmviral.com"),
      linkRow(NOT_READY_LEAD, "not-ready.dmviral.com"),
      linkRow(OTHER_LEAD, "other-co.dmviral.com"),
    ],
    sedcms_requests: [],
  }, SEDCMS_DEFAULTS, SEDCMS_UNIQUE);
  state.fromCalls = 0;
  state.notified = [];
  state.notifyFails = false;
  state.failWrites = {};
  state.ticketGate = null;
});
afterEach(() => restoreEnv());

const tickets = () => state.db!.tables.lead_tickets;
const items = () => state.db!.tables.ticket_items;
const created = () => state.db!.tables.activity_log.filter((r) => r.action === "ticket.created");

describe("signature and lead", () => {
  it("a bad signature is a 401, before any database read", async () => {
    for (const opts of [{ unsigned: true }, { secret: `${TEST_SECRET}-wrong` }, { tamper: (raw: string) => raw.replace("12", "13") }]) {
      const res = await send(LEAD, body(), opts);
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe("BAD_SIGNATURE");
    }
    expect(state.fromCalls).toBe(0);
    expect(tickets()).toHaveLength(0);
  });

  it("a deleted or unknown lead is a 404 NO_LEAD, and nothing is written", async () => {
    for (const id of [DELETED_LEAD, "99999999-9999-4999-8999-999999999999"]) {
      const res = await send(id, body({ requestId: crypto.randomUUID() }));
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("NO_LEAD");
    }
    expect(tickets()).toHaveLength(0);
    expect(state.notified).toHaveLength(0);
  });

  it("a body that isn't the contract's is a 400, and nothing is written", async () => {
    for (const bad of [
      body({ items: [] }),
      body({ items: Array.from({ length: 11 }, (_, i) => `item ${i}`) }),
      body({ items: ["x".repeat(2001)] }),
      body({ items: [""] }),
      body({ requestId: "not-a-uuid" }),
      body({ requestedBy: { name: "Zoë" } }),
      body({ requestedBy: undefined }),
      body({ extra: true }),
      body({ pageUrl: 5 }),
    ]) {
      const res = await send(LEAD, bad);
      expect(res.status, JSON.stringify(bad).slice(0, 80)).toBe(400);
    }
    expect(tickets()).toHaveLength(0);
  });
});

describe("the ticket", () => {
  it("is created on the lead as an open, unassigned Changes ticket with no creator", async () => {
    const res = await send(LEAD, body());
    expect(res.status).toBe(201);
    const { ticketId } = await res.json();
    expect(tickets()).toHaveLength(1);
    expect(tickets()[0]).toMatchObject({
      id: ticketId,
      lead_id: LEAD,
      category: "Changes",
      signature: "Agent",
      priority: "Normal",
      status: "Open",
      created_by: null,
      title: "Change request from Acme Roofing (SED CMS)",
    });
  });

  it("stores the items in order, exactly as given — markup and spaces included", async () => {
    const { ticketId } = await (await send(LEAD, body())).json();
    const rows = items().filter((i) => i.ticket_id === ticketId).sort((a, b) => Number(a.sort) - Number(b.sort));
    expect(rows.map((r) => [r.sort, r.body])).toEqual([
      [0, "Change the lunch special to $12"],
      [1, "  Keep the spaces as typed  "],
      [2, "<script>alert(1)</script>"],
    ]);
  });

  it("logs ticket.created with who asked, the page and the request id, as no LMS user", async () => {
    const { ticketId } = await (await send(LEAD, body())).json();
    expect(created()).toHaveLength(1);
    expect(created()[0]).toMatchObject({ user_id: null, action: "ticket.created", entity_type: "ticket", entity_id: ticketId });
    expect(created()[0].new_value).toEqual({
      via: "sedcms",
      requestId: REQUEST_ID,
      title: "Update the menu prices",
      requestedBy: { name: "Zoë Owner", email: "zoe@acme.example" },
      pageUrl: "https://acme-roofing.dmviral.com/menu.html",
    });
    const noPage = await send(LEAD, body({ requestId: crypto.randomUUID(), pageUrl: undefined }));
    expect(noPage.status).toBe(201);
    expect(created()[1].new_value).toMatchObject({ pageUrl: null });
  });

  it("calls the usual ticket-opened notification once", async () => {
    const { ticketId } = await (await send(LEAD, body())).json();
    expect(state.notified).toHaveLength(1);
    expect(state.notified[0]).toMatchObject({ eventKey: "ticket_opened", ticketId, leadId: LEAD, actorId: null, title: "Ticket needs assignment" });
    expect(String(state.notified[0].body)).toContain("Acme Roofing");
  });

  it("a failed notification doesn't fail the request", async () => {
    state.notifyFails = true;
    const res = await send(LEAD, body());
    expect(res.status).toBe(201);
    expect(tickets()).toHaveLength(1);
  });

  it("doesn't check the lead's status, unlike the staff route", async () => {
    expect(isTicketEligible("Not Ready")).toBe(false); // the staff route would refuse this lead
    const res = await send(NOT_READY_LEAD, body());
    expect(res.status).toBe(201);
    expect(tickets()[0]).toMatchObject({ lead_id: NOT_READY_LEAD });
  });
});

describe("idempotent by requestId", () => {
  it("the same requestId twice gives one ticket, answered both times, notified once", async () => {
    const first = await send(LEAD, body());
    const second = await send(LEAD, body());
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const a = await first.json();
    const b = await second.json();
    expect(b).toEqual(a);
    expect(tickets()).toHaveLength(1);
    expect(items()).toHaveLength(3);
    expect(created()).toHaveLength(1);
    expect(state.notified).toHaveLength(1);
  });

  it("two at once with the same requestId still make one ticket", async () => {
    const [x, y] = await Promise.all([send(LEAD, body()), send(LEAD, body())]);
    expect((await x.json()).ticketId).toBe((await y.json()).ticketId);
    expect(tickets()).toHaveLength(1);
  });

  it("a requestId already used on another lead is a 409, never that lead's ticket", async () => {
    expect((await send(OTHER_LEAD, body())).status).toBe(201);
    const res = await send(LEAD, body());
    expect(res.status).toBe(409);
    const answer = await res.json();
    expect(answer.code).toBe("REQUEST_ID_USED");
    expect(answer.ticketId).toBeUndefined();
    expect(tickets()).toHaveLength(1);
  });

  it("a different requestId is a new ticket", async () => {
    await send(LEAD, body());
    await send(LEAD, body({ requestId: "6f0c2d1e-3b4a-4c5d-8e6f-7a8b9c0d1e2f" }));
    expect(tickets()).toHaveLength(2);
  });
});

describe("idempotent on every process (probe-ticket-idempotency, inverted)", () => {
  const LOCKS = Symbol.for("sedcms.applyLocks");
  /** Notifications as the notifications table keeps them: one per dedup key (lib/tickets/notify.ts). */
  const notifications = () => new Set(state.notified.map((n) => `${n.eventKey}:${n.ticketId}:${n.nonce}`));
  const requests = () => state.db!.tables.sedcms_requests;
  const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

  it("when the activity_log write fails, the request fails, and the retry completes the same ticket, notified once", async () => {
    const err = quiet();
    state.failWrites.activity_log = 1;
    const first = await send(LEAD, body());
    expect(first.status).toBe(500); // not done: who asked is only in that row
    expect(state.notified).toHaveLength(0);
    const retry = await send(LEAD, body());
    expect(retry.status).toBe(201);
    expect(tickets()).toHaveLength(1);
    expect(items()).toHaveLength(3);
    expect(created()).toHaveLength(1);
    expect(state.notified).toHaveLength(1);
    expect((await retry.json()).ticketId).toBe(tickets()[0].id);
    expect(requests()).toEqual([expect.objectContaining({ request_id: REQUEST_ID, lead_id: LEAD, kind: "ticket", ticket_id: tickets()[0].id, completed_at: expect.any(String) })]);
    err.mockRestore();
  });

  it("a delivery that stopped after the ticket (its items failed) is completed by the next: one ticket, every item", async () => {
    const err = quiet();
    state.failWrites.ticket_items = 1;
    expect((await send(LEAD, body())).status).toBe(500);
    expect(tickets()).toHaveLength(1); // made, not yet complete
    expect(requests()[0].completed_at).toBeNull();
    const retry = await send(LEAD, body());
    expect(retry.status).toBe(201);
    expect(tickets()).toHaveLength(1);
    expect(items().map((i) => i.body)).toEqual(body().items);
    expect(notifications().size).toBe(1);
    err.mockRestore();
  });

  it("a crash after the notification, before the request was marked done: the retry adds nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const real = state.db!.client.from.bind(state.db!.client);
    // the "done" write is lost, as if the process died right before it
    (state.db!.client as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = real(t) as unknown as Record<string, unknown>;
      return t === "sedcms_requests" ? { ...q, insert: q.insert, select: q.select, update: () => ({ eq: () => ({ is: async () => ({ error: { message: "connection lost" } }) }) }) } : q;
    };
    expect((await send(LEAD, body())).status).toBe(201);
    (state.db!.client as unknown as { from: (t: string) => unknown }).from = real;
    expect(requests()[0].completed_at).toBeNull();
    expect((await send(LEAD, body())).status).toBe(201);
    expect(tickets()).toHaveLength(1);
    expect(items()).toHaveLength(3);
    expect(created()).toHaveLength(1);
    expect(notifications().size).toBe(1); // a second call, the same dedup key: the table keeps one
    warn.mockRestore();
  });

  it("two deliveries on two processes, the second while the first is mid-way: one ticket, one notification", async () => {
    let open!: () => void;
    state.ticketGate = new Promise<void>((r) => (open = r));
    const a = send(LEAD, body()); // process 1: claims, then waits at its ticket insert
    for (let i = 0; i < 100 && requests().length === 0; i++) await new Promise((r) => setTimeout(r, 1));
    expect(requests()).toHaveLength(1);
    (globalThis as Record<symbol, unknown>)[LOCKS] = new Map(); // process 2 has its own locks
    const b = await send(LEAD, body()); // finds the claim incomplete, and completes it
    expect(b.status).toBe(201);
    open();
    const ra = await a; // finds the ticket made, and finishes without making another
    expect(ra.status).toBe(201);
    expect((await ra.json()).ticketId).toBe((await b.json()).ticketId);
    expect(tickets()).toHaveLength(1);
    expect(items()).toHaveLength(3);
    expect(created()).toHaveLength(1);
    expect(notifications().size).toBe(1);
  });

  it("a completed request is answered from its record, writing nothing", async () => {
    const { ticketId } = await (await send(LEAD, body())).json();
    const writes = state.db!.writes.length;
    const again = await send(LEAD, body());
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual({ ticketId });
    expect(state.db!.writes.length).toBe(writes);
    expect(state.notified).toHaveLength(1);
  });

  it("the same id with other content, or an apply's id, is a 409 REQUEST_ID_USED", async () => {
    expect((await send(LEAD, body())).status).toBe(201);
    const other = await send(LEAD, body({ items: ["Something else"] }));
    expect(other.status).toBe(409);
    expect((await other.json()).code).toBe("REQUEST_ID_USED");
    const APPLY_ID = "7f0c2d1e-3b4a-4c5d-8e6f-7a8b9c0d1e2f";
    state.db!.tables.sedcms_requests.push({ request_id: APPLY_ID, lead_id: LEAD, kind: "apply", digest: "0".repeat(64), ticket_id: null, completed_at: null });
    const reused = await send(LEAD, body({ requestId: APPLY_ID }));
    expect(reused.status).toBe(409);
    expect(tickets()).toHaveLength(1);
  });

  it("the ids are derived from the request: the same request always names the same ticket", async () => {
    const { changeTicketIds } = await import("@/lib/sedcms/tickets");
    const ids = changeTicketIds(REQUEST_ID, 3);
    expect(changeTicketIds(REQUEST_ID, 3)).toEqual(ids);
    expect(new Set([ids.ticket, ids.log, ...ids.items]).size).toBe(5);
    for (const id of [ids.ticket, ids.log, ...ids.items]) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const { ticketId } = await (await send(LEAD, body())).json();
    expect(ticketId).toBe(ids.ticket);
    expect(changeTicketIds("6f0c2d1e-3b4a-4c5d-8e6f-7a8b9c0d1e2f", 3).ticket).not.toBe(ids.ticket);
  });
});
