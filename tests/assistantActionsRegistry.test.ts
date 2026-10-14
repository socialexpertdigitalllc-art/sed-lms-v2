// @vitest-environment node
import { describe, it, expect } from "vitest";
import { ACTION_DEFS, actionCatalogue, getActionDef } from "@/lib/assistant/actions/registry";
import { REF_KINDS } from "@/lib/assistant/actions/refs";
import type { ActionContext } from "@/lib/assistant/actions/types";

/**
 * Every action SED AI can propose, checked as a whole: the catalogue the
 * product owner approved is all there, keys are unique, and each definition
 * is internally consistent (its fields, bulk list and plan outputs).
 */

const APPROVED = [
  // Leads
  "lead.create", "lead.update", "lead.status", "lead.followup", "lead.reschedule", "lead.tags", "lead.assign", "lead.bulk", "lead.archive",
  // Pre-leads
  "prelead.create", "prelead.update", "prelead.convert",
  // Tickets
  "ticket.create", "ticket.assign", "ticket.work", "ticket.resolve",
  // AI developer
  "agent.send", "agent.revise", "agent.discard", "agent.approve",
  // Site Builder
  "build.start", "build.regen", "build.deploy", "build.bulk", "build.delete",
  // Websites & domains
  "domain.check", "domain.health", "site.link", "site.restore", "site.transfer", "domain.dns", "site.takedown", "domain.buy", "domain.autorenew",
  // Money
  "receipt.create", "receipt.send", "contract.draft", "contract.send",
  // Email (the draft is the card of email.send)
  "email.send",
  // Agency website
  "cms.lead", "cms.coupon",
  // Client forms
  "form.setup", "form.resend",
  // Team, personal, admin
  "feedback.submit", "notification.read", "reminder.create", "import.sheet", "user.admin", "perm.admin", "settings.admin",
  // Ideas: standing rules, holiday handover
  "rule.create", "handoff.start",
];

const ctx = { userId: "u", displayName: "U", perms: new Set<string>(), db: {} as never, admin: {} as never, timezone: "Asia/Karachi", now: new Date(), isAdmin: false } as ActionContext;

describe("the action catalogue", () => {
  it("has every approved action", () => {
    const keys = new Set(ACTION_DEFS.map((d) => d.key));
    expect(APPROVED.filter((k) => !keys.has(k))).toEqual([]);
    // Agency-website content: one action per kind of content.
    expect(ACTION_DEFS.filter((d) => d.key.startsWith("cms.")).length).toBeGreaterThanOrEqual(3);
  });

  it("has unique, well-formed keys", () => {
    const keys = ACTION_DEFS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z]+\.[a-z_]+$/);
    expect(getActionDef("lead.create")?.title).toBe("Create a lead");
  });

  it("defines every action consistently", () => {
    for (const d of ACTION_DEFS) {
      const where = d.key;
      expect(d.title, where).toBeTruthy();
      expect(d.description.length, where).toBeGreaterThan(20);
      expect(d.confirmLabel, where).toBeTruthy();
      const names = d.fields.map((f) => f.name);
      expect(new Set(names).size, `${where}: duplicate field`).toBe(names.length);
      for (const f of d.fields) {
        expect(f.label, `${where}.${f.name}`).toBeTruthy();
        if (f.type === "ref" || f.type === "refs") expect(REF_KINDS, `${where}.${f.name}`).toContain(f.ref);
        if (f.type === "enum" || f.type === "multi") expect(f.options, `${where}.${f.name}`).toBeTruthy();
      }
      if (d.bulkField) {
        const f = d.fields.find((x) => x.name === d.bulkField);
        expect(f && ["refs", "list"].includes(f.type), `${where}: bulkField`).toBe(true);
      }
      if (d.produces) expect(REF_KINDS, where).toContain(d.produces);
      expect(typeof d.allowed(ctx) === "string" || d.allowed(ctx) === null, where).toBe(true);
    }
  });

  it("lists the actions for the model, grouped, marking the ones that need an approver", () => {
    const text = actionCatalogue({ ...ctx, perms: new Set(["leads.create"]) }, new Set(["lead.archive"]));
    expect(text).toMatch(/^Leads:/m);
    expect(text).toMatch(/- lead\.create: Create a lead\n/);
    expect(text).not.toMatch(/lead\.archive/);
    expect(text).toMatch(/lead\.update: .*needs an approver for you/);
  });
});
