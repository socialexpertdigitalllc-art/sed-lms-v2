import { describe, it, expect } from "vitest";
import { canTransition, itemProgress, isTicketEligible, dedupKey } from "@/lib/tickets/logic";

describe("canTransition", () => {
  it("Open→Assigned ok", () => expect(canTransition("Open", "Assigned")).toBe(true));
  it("Assigned→In Progress ok", () => expect(canTransition("Assigned", "In Progress")).toBe(true));
  it("In Progress→Resolved ok", () => expect(canTransition("In Progress", "Resolved")).toBe(true));
  it("Resolved→In Progress ok (reopen)", () => expect(canTransition("Resolved", "In Progress")).toBe(true));
  it("Open→Resolved rejected", () => expect(canTransition("Open", "Resolved")).toBe(false));
  it("Assigned→Assigned ok (reassign)", () => expect(canTransition("Assigned", "Assigned")).toBe(true));
});
describe("itemProgress", () => {
  it("counts done/total", () => expect(itemProgress([{ is_done: true }, { is_done: false }, { is_done: true }] as any)).toEqual({ done: 2, total: 3 }));
  it("empty", () => expect(itemProgress([])).toEqual({ done: 0, total: 0 }));
});
describe("isTicketEligible", () => {
  it("Ready/Long Term eligible", () => { expect(isTicketEligible("Ready")).toBe(true); expect(isTicketEligible("Long Term")).toBe(true); });
  it("Not Ready ineligible", () => expect(isTicketEligible("Not Ready")).toBe(false));
});
describe("dedupKey", () => {
  it("includes event, ticket, recipient, nonce", () => expect(dedupKey("ticket_assigned", "t1", "u1", "n1")).toBe("ticket_assigned:t1:u1:n1"));
});
