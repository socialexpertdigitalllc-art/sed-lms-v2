import { describe, it, expect } from "vitest";
import { ticketInScope, canActOnTicket, type TicketScope } from "@/lib/tickets/scope";

const ticket = (created_by: string | null, lead_id: string) => ({ created_by, lead_id });

describe("ticketInScope", () => {
  const allScope: TicketScope = { all: true };
  const userScope: TicketScope = { all: false, leadIds: new Set(["lead-1", "lead-2"]) };

  it("all-scope sees every ticket", () => {
    expect(ticketInScope(ticket("someone-else", "lead-x"), "u1", allScope)).toBe(true);
    expect(ticketInScope(ticket(null, "lead-y"), "u1", allScope)).toBe(true);
  });

  it("creator match: own ticket visible even on an unassigned lead", () => {
    expect(ticketInScope(ticket("u1", "lead-x"), "u1", userScope)).toBe(true);
  });

  it("lead match: colleague's ticket visible on the user's own lead", () => {
    expect(ticketInScope(ticket("someone-else", "lead-2"), "u1", userScope)).toBe(true);
    expect(ticketInScope(ticket(null, "lead-1"), "u1", userScope)).toBe(true);
  });

  it("no match: not creator, lead not assigned", () => {
    expect(ticketInScope(ticket("someone-else", "lead-x"), "u1", userScope)).toBe(false);
    expect(ticketInScope(ticket(null, "lead-x"), "u1", userScope)).toBe(false);
  });

  it("empty lead scope hides everything not self-created", () => {
    const empty: TicketScope = { all: false, leadIds: new Set() };
    expect(ticketInScope(ticket("someone-else", "lead-1"), "u1", empty)).toBe(false);
    expect(ticketInScope(ticket("u1", "lead-1"), "u1", empty)).toBe(true);
  });
});

describe("canActOnTicket (resolve / item-toggle object gate)", () => {
  const t = (created_by: string | null, lead_id: string, assigned_to: string | null) => ({
    created_by,
    lead_id,
    assigned_to,
  });
  const allScope: TicketScope = { all: true };
  const userScope: TicketScope = { all: false, leadIds: new Set(["lead-1"]) };

  it("all-scope (tickets.view_all) may act on any ticket", () => {
    expect(canActOnTicket(t("someone-else", "lead-x", null), "u1", allScope)).toBe(true);
  });

  it("in-scope via creator or own lead may act", () => {
    expect(canActOnTicket(t("u1", "lead-x", null), "u1", userScope)).toBe(true);
    expect(canActOnTicket(t("someone-else", "lead-1", null), "u1", userScope)).toBe(true);
  });

  it("assignee may act even when the ticket is outside their view scope", () => {
    expect(canActOnTicket(t("someone-else", "lead-x", "u1"), "u1", userScope)).toBe(true);
  });

  it("out of scope and not the assignee is denied", () => {
    expect(canActOnTicket(t("someone-else", "lead-x", null), "u1", userScope)).toBe(false);
    expect(canActOnTicket(t("someone-else", "lead-x", "u2"), "u1", userScope)).toBe(false);
    expect(canActOnTicket(t(null, "lead-x", null), "u1", userScope)).toBe(false);
  });
});
