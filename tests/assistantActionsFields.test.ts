// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  editSpecFor,
  formatDateTime,
  matchOption,
  missingFields,
  normalizeFields,
  normalizeUrl,
  parseBoolean,
  parseDateTime,
  parseList,
  parseNumber,
} from "@/lib/assistant/actions/fields";
import type { ActionContext, ActionDef } from "@/lib/assistant/actions/types";
import { LEAD_STATUSES } from "@/lib/leads/types";

/**
 * How what the model sends becomes checked values — the part every action
 * shares. A wrong conversion here (a time read in the wrong timezone, a "$1,200"
 * read as NaN) would be wrong on EVERY action, so each type is pinned.
 */

const NOW = new Date("2026-10-14T10:00:00Z"); // 15:00 in Karachi
const ctx = { userId: "u1", displayName: "Sam", perms: new Set<string>(), db: {} as never, admin: {} as never, timezone: "Asia/Karachi", now: NOW, isAdmin: false } as ActionContext;

const def: ActionDef = {
  key: "test.thing",
  group: "Leads",
  title: "Test",
  description: "",
  confirmLabel: "Go",
  risk: "standard",
  allowed: () => null,
  execute: async () => ({ message: "ok" }),
  fields: [
    { name: "name", label: "Name", type: "text", required: true, max: 20 },
    { name: "phone", label: "Phone", type: "phone", required: true },
    { name: "email", label: "Email", type: "email" },
    { name: "kind", label: "Kind", type: "enum", options: ["Fresh", "Follow Up"], required: true },
    { name: "why", label: "Why", type: "text", required: true, showIf: (v) => v.kind === "Follow Up" },
    { name: "when", label: "When", type: "datetime", future: true },
    { name: "price", label: "Price", type: "money", min: 0 },
    { name: "pages", label: "Pages", type: "multi", options: ["Home", "About Us", "Contact Us"] },
    { name: "rating", label: "Rating", type: "rating", min: 1, max: 10 },
    { name: "flag", label: "Flag", type: "boolean", default: false },
    { name: "colors", label: "Colours", type: "colors", min: 2, max: 3 },
  ],
};

describe("value parsers", () => {
  it("reads a time without a zone as company time, and keeps an explicit offset", () => {
    expect(parseDateTime("2026-10-15T10:00", "Asia/Karachi")?.toISOString()).toBe("2026-10-15T05:00:00.000Z");
    expect(parseDateTime("2026-10-15 10:00", "Asia/Karachi")?.toISOString()).toBe("2026-10-15T05:00:00.000Z");
    expect(parseDateTime("2026-10-15T10:00-05:00", "Asia/Karachi")?.toISOString()).toBe("2026-10-15T15:00:00.000Z");
    expect(parseDateTime("2026-10-15T10:00:00Z", "Asia/Karachi")?.toISOString()).toBe("2026-10-15T10:00:00.000Z");
    expect(parseDateTime("tomorrow", "Asia/Karachi")).toBeNull();
    expect(parseDateTime("2026-02-30T10:00", "Asia/Karachi")).toBeNull();
  });

  it("formats a time in the company timezone", () => {
    expect(formatDateTime("2026-10-15T05:00:00Z", "Asia/Karachi", NOW)).toMatch(/Thu, Oct 15, 10:00\s?AM/);
  });

  it("reads money and numbers the way people write them", () => {
    expect(parseNumber("$1,200")).toBe(1200);
    expect(parseNumber("1.5k")).toBe(1500);
    expect(parseNumber("500 dollars")).toBe(500);
    expect(parseNumber(750)).toBe(750);
    expect(parseNumber("about five hundred")).toBeNull();
  });

  it("reads yes and no, in English and Roman Urdu", () => {
    expect(parseBoolean("yes")).toBe(true);
    expect(parseBoolean("haan")).toBe(true);
    expect(parseBoolean("nahi")).toBe(false);
    expect(parseBoolean("maybe")).toBeNull();
  });

  it("adds the missing scheme to a web address and refuses non-addresses", () => {
    expect(normalizeUrl("maps.app.goo.gl/abc")).toBe("https://maps.app.goo.gl/abc");
    expect(normalizeUrl("https://yelp.com/biz/x")).toBe("https://yelp.com/biz/x");
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("call me")).toBeNull();
  });

  it("splits lists and drops repeats", () => {
    expect(parseList("Plumbing, Drains\nWater heaters; plumbing")).toEqual(["Plumbing", "Drains", "Water heaters"]);
    expect(parseList(["- a", "• b", ""])).toEqual(["a", "b"]);
  });

  it("matches an option however it is typed", () => {
    expect(matchOption("long term", LEAD_STATUSES)).toBe("Long Term");
    expect(matchOption("not-ready", LEAD_STATUSES)).toBe("Not Ready");
    expect(matchOption("won", LEAD_STATUSES)).toBeNull();
  });
});

describe("normalizeFields", () => {
  it("cleans every type and says exactly what is wrong", async () => {
    const n = await normalizeFields(
      def,
      {
        name: "  Jumbo's   Pizza ",
        phone: "252 401 2775",
        email: "OWNER@Jumbos.COM",
        kind: "fresh",
        when: "2026-10-15T10:00",
        price: "$500",
        pages: "home, contact us",
        rating: "8",
        colors: "navy, #ffffff",
      },
      ctx,
    );
    expect(n.problems).toEqual([]);
    expect(n.values).toMatchObject({
      name: "Jumbo's Pizza",
      phone: "(252) 401-2775",
      email: "owner@jumbos.com",
      kind: "Fresh",
      when: "2026-10-15T05:00:00.000Z",
      price: 500,
      pages: ["Home", "Contact Us"],
      rating: 8,
      flag: false,
    });
    expect(n.display.price).toBe("$500");
    expect(n.display.rating).toBe("8 / 10");
  });

  it("refuses bad values with the reason, never guessing", async () => {
    const n = await normalizeFields(def, { phone: "12345", kind: "Hot", when: "2026-10-14T09:00", rating: 11, email: "nope", colors: "blue" }, ctx);
    const byField = Object.fromEntries(n.problems.map((p) => [p.field, p.message]));
    expect(byField.phone).toMatch(/10-digit/);
    expect(byField.kind).toMatch(/Fresh, Follow Up/);
    expect(byField.when).toMatch(/future/);
    expect(byField.rating).toMatch(/at most 10/);
    expect(byField.email).toMatch(/not a valid email/);
    expect(byField.colors).toMatch(/at least 2/);
  });

  it("flags a field name the action does not have, with a suggestion — and ignores scratch keys", async () => {
    const n = await normalizeFields(def, { name: "X", phone_number: "2524012775", __name: "kept aside" }, ctx);
    expect(n.problems).toEqual([expect.objectContaining({ field: "phone_number", message: expect.stringMatching(/did you mean "phone"/) })]);
    expect(n.values).not.toHaveProperty("__name");
  });

  it("drops values for fields that do not apply, and asks only for what does", async () => {
    const fresh = await normalizeFields(def, { name: "A", phone: "2524012775", kind: "Fresh", why: "irrelevant" }, ctx);
    expect(fresh.values).not.toHaveProperty("why");
    expect(missingFields(def, fresh.values, fresh.problems)).toEqual([]);
    const follow = await normalizeFields(def, { name: "A", phone: "2524012775", kind: "Follow Up" }, ctx);
    expect(missingFields(def, follow.values, follow.problems).map((f) => f.name)).toEqual(["why"]);
  });

  it("lists missing required fields in order, not the ones that are wrong", async () => {
    const n = await normalizeFields(def, { phone: "bad" }, ctx);
    expect(missingFields(def, n.values, n.problems).map((f) => f.name)).toEqual(["name", "kind"]);
  });
});

describe("card editors", () => {
  it("offers a datetime as company wall-clock time and an enum with its options", async () => {
    const when = await editSpecFor(def.fields.find((f) => f.name === "when")!, "2026-10-15T05:00:00.000Z", ctx);
    expect(when).toEqual({ type: "datetime", raw: "2026-10-15T10:00" });
    const kind = await editSpecFor(def.fields.find((f) => f.name === "kind")!, "Fresh", ctx);
    expect(kind?.options?.map((o) => o.value)).toEqual(["Fresh", "Follow Up"]);
    const rating = await editSpecFor(def.fields.find((f) => f.name === "rating")!, 8, ctx);
    expect(rating?.options).toHaveLength(10);
  });
});
