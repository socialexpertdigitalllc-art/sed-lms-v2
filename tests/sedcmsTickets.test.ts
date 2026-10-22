// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";
import { withEnv } from "./helpers/fakeSiteHosts";
import { TEST_SECRET, leadPath, routeCtx, signedRequest } from "./helpers/sedcmsRoutes";
import { isTicketEligible } from "@/lib/tickets/logic";

/**
 * POST /api/internal/sedcms/leads/{id}/tickets (launch plan L6): a client's
 * "Request a change" in SED CMS becomes a ticket on the lead — idempotent by
 * requestId, with the usual "ticket opened" notification. Unlike the staff
 * route, the lead's status isn't checked: a client asking for a change to
 * their own live site is always eligible.
 */

const state = vi.hoisted(() => ({
  db: null as MemoryDb | null,
  fromCalls: 0,
  notified: [] as Record<string, unknown>[],
  notifyFails: false,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      state.fromCalls++;
      return state.db!.client.from(table);
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
  });
  state.fromCalls = 0;
  state.notified = [];
  state.notifyFails = false;
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
