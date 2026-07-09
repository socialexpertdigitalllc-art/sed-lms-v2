import { describe, it, expect } from "vitest";
import { createTicketSchema, ticketActionSchema } from "@/lib/tickets/schema";

describe("createTicketSchema", () => {
  const base = { category: "Changes", signature: "Agent", priority: "Normal", items: ["change one", "change two"] };
  it("accepts a valid ticket", () => expect(createTicketSchema.safeParse(base).success).toBe(true));
  it("requires at least one item", () => expect(createTicketSchema.safeParse({ ...base, items: [] }).success).toBe(false));
  it("rejects bad category", () => expect(createTicketSchema.safeParse({ ...base, category: "Nope" }).success).toBe(false));
});
describe("ticketActionSchema", () => {
  it("assign needs assigned_to", () => expect(ticketActionSchema.safeParse({ action: "assign", assigned_to: "11111111-1111-4111-8111-111111111111" }).success).toBe(true));
  it("resolve needs a note", () => expect(ticketActionSchema.safeParse({ action: "resolve", resolution_note: "done" }).success).toBe(true));
  it("resolve without note fails", () => expect(ticketActionSchema.safeParse({ action: "resolve" }).success).toBe(false));
  it("start/reopen need no extra", () => { expect(ticketActionSchema.safeParse({ action: "start" }).success).toBe(true); expect(ticketActionSchema.safeParse({ action: "reopen" }).success).toBe(true); });
});
