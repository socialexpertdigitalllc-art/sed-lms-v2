// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * SED AI's pre-lead actions: who may use them (the endpoints' own rules),
 * what they ask for (the New Pre-Lead form's required fields), the duplicate
 * check, what reaches the endpoints — and turning a pre-lead into a lead,
 * where everything the pre-lead already has is copied and only the rest is
 * asked for.
 */

const routes = vi.hoisted(() => ({ preLeadsPost: vi.fn(), preLeadPatch: vi.fn(), leadsPost: vi.fn() }));
vi.mock("@/app/api/pre-leads/route", () => ({ POST: routes.preLeadsPost }));
vi.mock("@/app/api/pre-leads/[id]/route", () => ({ PATCH: routes.preLeadPatch }));
vi.mock("@/app/api/leads/route", () => ({ POST: routes.leadsPost }));
// The free network checks (DNS, opening the profile link) are not under test here.
vi.mock("@/lib/assistant/actions/checks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assistant/actions/checks")>();
  const none = async () => ({ problems: [], warnings: [], notes: [] });
  return { ...actual, checkEmail: vi.fn(none), checkProfileLink: vi.fn(none) };
});

import { PRELEAD_ACTIONS } from "@/lib/assistant/actions/defs/preleads";
import { missingFields, normalizeFields } from "@/lib/assistant/actions/fields";
import type { ActionContext, ActionDef, StoredAction, Values } from "@/lib/assistant/actions/types";

type Row = Record<string, unknown>;

/** A chainable stand-in for supabase-js over fixture rows; writes are recorded (updates also applied). */
function fakeDb(tables: Record<string, Row[]>) {
  const writes: { table: string; op: string; value: unknown; where: Record<string, unknown> }[] = [];
  const client = {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      const where: Record<string, unknown> = {};
      let single = false;
      let limit: number | null = null;
      let op = "select";
      let value: unknown = null;
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        order: () => b,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), (where[c] = v), b),
        neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), b),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
        ilike: (c: string, p: string) => (filters.push((r) => String(r[c] ?? "").toLowerCase().includes(p.replace(/%/g, "").toLowerCase())), b),
        limit: (n: number) => ((limit = n), b),
        maybeSingle: () => ((single = true), b),
        single: () => ((single = true), b),
        update: (v: unknown) => ((op = "update"), (value = v), b),
        insert: (v: unknown) => ((op = "insert"), (value = v), b),
        then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
          const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
          if (op !== "select") {
            writes.push({ table, op, value, where });
            if (op === "update") rows.forEach((r) => Object.assign(r, value as Row));
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          }
          // Fresh objects, as a real client returns.
          const out = (limit === null ? rows : rows.slice(0, limit)).map((r) => ({ ...r }));
          return Promise.resolve(single ? { data: out[0] ?? null, error: null } : { data: out, error: null }).then(resolve, reject);
        },
      });
      return b;
    },
  };
  return { client: client as unknown as SupabaseClient, writes, tables };
}

const ME = "11111111-1111-4111-8111-111111111111";
const SARA = "22222222-2222-4222-8222-222222222222";
const PL = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-14T10:00:00Z");

const preLead = (over: Row = {}): Row => ({
  id: PL,
  agent_id: ME,
  business_name: "Jumbo's Pizza",
  phone_number: "(252) 401-2775",
  email: "owner@jumbos.com",
  owner_name: "Sam",
  google_yelp_link: "https://www.google.com/maps/place/Jumbos+Pizza",
  areas: ["Raleigh", "Cary"],
  services: ["Pizza", "Catering"],
  service_offered: "Website",
  service_type: "Redesign",
  pricing: 500,
  lead_category: "Strong Lead",
  status: "Next follow up",
  follow_up_time: "2026-10-20T05:00:00+00:00",
  comments: "Wants a new menu page",
  updated_at: "2026-10-14T08:00:00+00:00",
  deleted_at: null,
  ...over,
});

function setup(perms: string[], tables: Record<string, Row[]> = {}) {
  const db = fakeDb({
    profiles: [
      { id: ME, display_name: "Me", email: "me@sed.test", is_active: true },
      { id: SARA, display_name: "Sara", email: "sara@sed.test", is_active: true },
    ],
    pre_leads: [],
    leads: [],
    activity_log: [],
    ...tables,
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

const def = (key: string): ActionDef => PRELEAD_ACTIONS.find((d) => d.key === key)!;
const create = def("prelead.create");
const update = def("prelead.update");
const convert = def("prelead.convert");

async function prepared(d: ActionDef, raw: Values, ctx: ActionContext) {
  const n = await normalizeFields(d, raw, ctx);
  const missing = missingFields(d, n.values, n.problems).map((f) => f.name);
  return { ...n, missing };
}

const stored = (d: ActionDef, input: Values, before: unknown, result: StoredAction["result"] = null): StoredAction =>
  ({ id: "act-1", user_id: ME, action_key: d.key, input, before_state: before, result }) as unknown as StoredAction;

const lastJson = async (fn: ReturnType<typeof vi.fn>, call = -1) => {
  const calls = fn.mock.calls;
  const req = calls[call < 0 ? calls.length + call : call][0] as Request;
  return { req, body: (await req.json()) as Record<string, unknown> };
};

beforeEach(() => {
  routes.preLeadsPost.mockReset().mockImplementation(async () => Response.json({ id: "44444444-4444-4444-8444-444444444444" }, { status: 201 }));
  routes.preLeadPatch.mockReset().mockImplementation(async () => Response.json({ ok: true }));
  routes.leadsPost.mockReset().mockImplementation(async () => Response.json({ id: "55555555-5555-4555-8555-555555555555" }, { status: 201 }));
});

describe("who may use them (the endpoints' own permission checks)", () => {
  it("adding needs Create Pre-Lead", () => {
    expect(create.allowed(setup([]).ctx)).toBe("Your account doesn't have “Create Pre-Lead”.");
    expect(create.allowed(setup(["pre_leads.create"]).ctx)).toBeNull();
  });

  it("working one needs Edit Pre-Lead or Update Follow-up", () => {
    expect(update.allowed(setup([]).ctx)).toBe("Your account doesn't have “Edit Pre-Lead”.");
    expect(update.allowed(setup(["pre_leads.followup"]).ctx)).toBeNull();
    expect(update.allowed(setup(["pre_leads.edit"]).ctx)).toBeNull();
  });

  it("converting needs Create Lead and Update Follow-up (it creates the lead, then closes the pre-lead)", () => {
    expect(convert.allowed(setup(["leads.create"]).ctx)).toBe("Your account doesn't have “Update Follow-up”.");
    expect(convert.allowed(setup(["pre_leads.followup"]).ctx)).toBe("Your account doesn't have “Create Lead”.");
    expect(convert.allowed(setup(["leads.create", "pre_leads.followup"]).ctx)).toBeNull();
  });
});

describe("prelead.create", () => {
  it("asks for exactly what the New Pre-Lead form requires", async () => {
    const { ctx } = setup(["pre_leads.create"]);
    const website = await prepared(create, { business_name: "Jumbo's Pizza", service_offered: "Website" }, ctx);
    expect(website.missing).toEqual(["service_type", "phone_number", "google_yelp_link", "follow_up_time", "lead_category"]);
    const seo = await prepared(create, { business_name: "Jumbo's Pizza", service_offered: "seo", phone_number: "252 401 2775" }, ctx);
    expect(seo.values.service_offered).toBe("SEO");
    expect(seo.values.phone_number).toBe("(252) 401-2775");
    expect(seo.missing).toEqual(["google_yelp_link", "follow_up_time", "lead_category"]);
  });

  it("refuses a follow-up time in the past", async () => {
    const { ctx } = setup(["pre_leads.create"]);
    const n = await prepared(create, { follow_up_time: "2026-10-13T10:00" }, ctx);
    expect(n.problems[0]).toMatchObject({ field: "follow_up_time" });
  });

  it("runs the check-duplicate read: blocks, or warns when overriding with the permission", async () => {
    const tables = { pre_leads: [preLead({ agent_id: SARA, business_name: "Other name", email: null })] };
    const blocked = await create.check!({ business_name: "Jumbo's", phone_number: "(252) 401-2775" }, setup(["pre_leads.create"], tables).ctx);
    expect(blocked?.problems).toEqual([{ field: "phone_number", message: "This business is already in Pre-leads (same phone; Sara has it)." }]);

    const { ctx } = setup(["pre_leads.create", "leads.duplicate.override"], tables);
    const asked = await create.check!({ business_name: "Jumbo's", phone_number: "(252) 401-2775" }, ctx);
    expect(asked?.problems?.[0].message).toContain("Say if it should be saved anyway.");
    const overridden = await create.check!({ business_name: "Jumbo's", phone_number: "(252) 401-2775", override_duplicate: true }, ctx);
    expect(overridden?.problems).toEqual([]);
    expect(overridden?.warnings?.[0]).toContain("Saving anyway");
  });

  it("posts the form's payload to POST /api/pre-leads and can be taken back by its creator", async () => {
    const { ctx, db } = setup(["pre_leads.create"]);
    const n = await normalizeFields(
      create,
      {
        service_offered: "Website",
        service_type: "Fresh",
        business_name: " Jumbo's Pizza ",
        phone_number: "2524012775",
        google_yelp_link: "yelp.com/biz/jumbos",
        follow_up_time: "2026-10-15T15:00",
        lead_category: "strong lead",
        services: ["Pizza"],
      },
      ctx,
    );
    expect(n.problems).toEqual([]);
    const res = await create.execute(n.values, ctx, { actionId: "a", origin: "https://app" });
    const { req, body } = await lastJson(routes.preLeadsPost);
    expect(new URL(req.url).pathname).toBe("/api/pre-leads");
    expect(body).toEqual({
      business_name: "Jumbo's Pizza",
      lead_category: "Strong Lead",
      status: "Next follow up",
      service_offered: "Website",
      service_type: "Fresh",
      phone_number: "(252) 401-2775",
      email: null,
      owner_name: null,
      google_yelp_link: "https://yelp.com/biz/jumbos",
      pricing: null,
      areas: [],
      services: ["Pizza"],
      follow_up_time: "2026-10-15T10:00:00.000Z",
      comments: null,
      override: false,
    });
    expect(res.data).toEqual({ id: "44444444-4444-4444-8444-444444444444", kind: "pre_lead" });

    db.tables.pre_leads.push(preLead({ id: res.data!.id, agent_id: ME }));
    const msg = await create.undo!.run(stored(create, n.values, null, res), ctx);
    expect(msg).toBe("the pre-lead was removed again.");
    expect(db.writes.find((w) => w.table === "pre_leads")).toMatchObject({ op: "update", where: { id: res.data!.id } });
    expect(db.writes.find((w) => w.table === "activity_log")?.value).toMatchObject({ action: "pre_lead.deleted" });
  });

  it("does not let someone else undo adding a pre-lead", async () => {
    const { ctx, db } = setup(["pre_leads.create"]);
    db.tables.pre_leads.push(preLead({ id: "p2", agent_id: SARA }));
    await expect(create.undo!.run(stored(create, {}, null, { message: "", data: { id: "p2" } }), ctx)).rejects.toThrow("Only the person who added");
  });
});

describe("prelead.update", () => {
  it("follows the endpoint's rule: follow-up keys need Update Follow-up, anything else Edit Pre-Lead", async () => {
    const { ctx } = setup(["pre_leads.followup"], { pre_leads: [preLead()] });
    const followUp = await update.check!({ pre_lead: PL, status: "Dropped", lead_category: "Weak Lead" }, ctx);
    expect(followUp?.problems).toEqual([]);
    expect(followUp?.values).toEqual({ __name: "Jumbo's Pizza" });
    const details = await update.check!({ pre_lead: PL, phone_number: "(919) 555-0100" }, ctx);
    expect(details?.problems?.[0].message).toBe(
      "Your account doesn't have “Edit Pre-Lead”. It can only log follow-ups (status, category, next follow-up, follow-up note).",
    );
    const editOnly = await update.check!({ pre_lead: PL, follow_up_time: "2026-10-20T10:00:00.000Z" }, setup(["pre_leads.edit"], { pre_leads: [preLead()] }).ctx);
    expect(editOnly?.problems?.[0].message).toBe("Your account doesn't have “Update Follow-up”.");
  });

  it("says what is wrong with the combination", async () => {
    const { ctx } = setup(["pre_leads.edit", "pre_leads.followup"], { pre_leads: [preLead()] });
    expect((await update.check!({ pre_lead: PL }, ctx))?.problems?.[0]).toEqual({ field: "_", message: "Say what to change on the pre-lead." });
    expect((await update.check!({ pre_lead: PL, reason: "No Pickup", comments: "x" }, ctx))?.problems?.[0].field).toBe("reason");
    expect((await update.check!({ pre_lead: PL, reason: "No Pickup", status: "Closed" }, ctx))?.problems?.[0].message).toContain("only goes with Next follow up");
    const dropped = setup(["pre_leads.followup"], { pre_leads: [preLead({ status: "Dropped" })] }).ctx;
    expect((await update.check!({ pre_lead: PL, reason: "No Pickup" }, dropped))?.problems?.[0].message).toBe(
      "A No Pickup / Rescheduled note only goes with Next follow up — the pre-lead is Dropped; set the status too.",
    );
    expect((await update.check!({ pre_lead: PL, reason: "No Pickup", status: "Next follow up" }, dropped))?.problems).toEqual([]);
    expect((await update.check!({ pre_lead: PL, status: "Next follow up" }, ctx))?.problems?.[0].message).toBe("It is already Next follow up.");
    expect((await update.check!({ pre_lead: "66666666-6666-4666-8666-666666666666", status: "Closed" }, ctx))?.problems?.[0].field).toBe("pre_lead");
  });

  it("shows before → after (a follow-up note replaces the comments) and sends only what changes", async () => {
    const { ctx } = setup(["pre_leads.followup"], { pre_leads: [preLead()] });
    const n = await normalizeFields(update, { pre_lead: PL, reason: "No Pickup", follow_up_time: "2026-10-16T11:00" }, ctx);
    Object.assign(n.values, (await update.check!(n.values, ctx))?.values);
    const p = await update.preview!(n.values, ctx);
    expect(p.changes).toEqual([
      { label: "Next follow-up", from: "Tue, Oct 20, 10:00 AM", to: "Fri, Oct 16, 11:00 AM" },
      { label: "Comments", from: "Wants a new menu page", to: "No Pickup" },
    ]);
    expect(p.before).toMatchObject({ updated_at: "2026-10-14T08:00:00+00:00", comments: "Wants a new menu page" });

    const res = await update.execute(n.values, ctx, { actionId: "a", origin: "" });
    const { req, body } = await lastJson(routes.preLeadPatch);
    expect(new URL(req.url).pathname).toBe(`/api/pre-leads/${PL}`);
    expect(body).toEqual({ follow_up_time: "2026-10-16T06:00:00.000Z", reason: "No Pickup" });
    expect(res.message).toBe("Updated Jumbo's Pizza (2 changes).");

    // Undo as a follow-up-only account: the old comments go back the way the note came in.
    await update.undo!.run(stored(update, n.values, p.before, res), ctx);
    expect((await lastJson(routes.preLeadPatch)).body).toEqual({ follow_up_time: "2026-10-20T05:00:00+00:00", reason: "Wants a new menu page" });
  });

  it("undoes a details edit with the previous values, and refuses a stale proposal", async () => {
    const { ctx, db } = setup(["pre_leads.edit"], { pre_leads: [preLead({ email: null })] });
    const input = { pre_lead: PL, email: "new@jumbos.com", areas: ["Durham"] };
    const p = await update.preview!({ ...input }, ctx);
    expect(p.changes).toEqual([
      { label: "Email", from: "—", to: "new@jumbos.com" },
      { label: "Areas", from: "Raleigh, Cary", to: "Durham" },
    ]);
    await update.undo!.run(stored(update, input, p.before, { message: "", data: { id: PL } }), ctx);
    expect((await lastJson(routes.preLeadPatch)).body).toEqual({ email: null, areas: ["Raleigh", "Cary"] });

    expect(await update.stale!(p.before, input, ctx)).toBeNull();
    db.tables.pre_leads[0].updated_at = "2026-10-14T09:30:00+00:00";
    expect(await update.stale!(p.before, input, ctx)).toBe("it was changed by someone else after this was proposed.");
  });
});

describe("prelead.convert", () => {
  const PERMS = ["leads.create", "pre_leads.followup"];
  const REST = {
    client_experience: 12,
    specify_pages: ["Home", "Services", "Contact Us"],
    color_scheme: "#1E40AF, #FFFFFF",
    follow_up_time: "2026-10-16T15:00",
    price_quoted: 500,
    rating: 8,
    fresh_or_followup: "Follow Up",
  };

  it("copies what the pre-lead has and asks only for the rest", async () => {
    const { ctx } = setup(PERMS, { pre_leads: [preLead()] });
    const n = await prepared(convert, { pre_lead: "Jumbo's Pizza" }, ctx);
    expect(n.problems).toEqual([]);
    expect(n.values).toMatchObject({
      pre_lead: PL,
      business_name: "Jumbo's Pizza",
      owner_name: "Sam",
      business_phone: "(252) 401-2775",
      business_email: "owner@jumbos.com",
      business_profile_link: "https://www.google.com/maps/place/Jumbos+Pizza",
      platform: "Google",
      site_type: "Redesign",
      has_service_areas: true,
      service_areas: ["Raleigh", "Cary"],
      services: ["Pizza", "Catering"],
      comments: "Wants a new menu page",
      agent: ME,
      closed_by: ME,
      status: "Not Ready",
    });
    // Copied values read back like anything the person said.
    expect(n.display.business_phone).toBe("(252) 401-2775");
    expect(n.missing).toEqual(["client_experience", "specify_pages", "color_scheme", "follow_up_time", "price_quoted", "rating", "fresh_or_followup"]);
  });

  it("re-checks cleanly on Confirm, in a new request, from the stored values", async () => {
    const first = setup(PERMS, { pre_leads: [preLead()] });
    const n = await prepared(convert, { pre_lead: PL, ...REST }, first.ctx);
    expect(n.missing).toEqual([]);
    // Confirm runs normalizeFields again on what was stored, with a fresh context.
    const again = await prepared(convert, { ...n.values }, setup(PERMS, { pre_leads: [preLead()] }).ctx);
    expect(again.problems).toEqual([]);
    expect(again.missing).toEqual([]);
    expect(again.values).toEqual(n.values);
  });

  it("never overrides what the person said, and asks for what the pre-lead lacks", async () => {
    const { ctx } = setup(PERMS, { pre_leads: [preLead({ email: null, areas: [], service_type: "Fresh", google_yelp_link: "https://example.com/jumbos", agent_id: SARA })] });
    const n = await prepared(convert, { pre_lead: PL, business_phone: "919-555-0100", comments: "Closed on the second call" }, ctx);
    expect(n.values.business_phone).toBe("(919) 555-0100");
    expect(n.values.comments).toBe("Closed on the second call");
    expect(n.values.agent).toBe(SARA);
    expect(n.missing).toEqual(expect.arrayContaining(["business_email", "site_type", "platform", "has_service_areas"]));
    expect(n.missing).not.toContain("business_profile_link");
  });

  it("checks with lead.create's rules, and says when the pre-lead is already Closed", async () => {
    const { ctx, db } = setup(PERMS, { pre_leads: [preLead({ status: "Closed" })] });
    const n = await prepared(convert, { pre_lead: PL, ...REST }, ctx);
    expect(n.missing).toEqual([]);
    const ok = await convert.check!(n.values, ctx);
    expect(ok?.problems).toEqual([]);
    expect(ok?.warnings?.[0]).toBe("Jumbo's Pizza is already Closed — check it was not turned into a lead before.");
    expect(ok?.values).toMatchObject({ __pre_status: "Closed" });

    db.tables.leads.push({ id: "l1", business_name: "Jumbo's Pizza", business_phone: null, business_email: null, agent_id: SARA, deleted_at: null });
    const dup = await convert.check!(n.values, ctx);
    expect(dup?.problems?.[0]).toMatchObject({ field: "business_name", message: expect.stringContaining("already in the system") });
  });

  it("creates the lead through POST /api/leads, then closes the pre-lead; undo reverses both", async () => {
    const { ctx, db } = setup(PERMS, { pre_leads: [preLead()] });
    const n = await normalizeFields(convert, { pre_lead: PL, ...REST }, ctx);
    Object.assign(n.values, (await convert.check!(n.values, ctx))?.values);
    const p = await convert.preview!(n.values, ctx);
    expect(p.title).toBe("Turn pre-lead Jumbo's Pizza into a lead");
    expect(p.notes).toContain("The pre-lead Jumbo's Pizza is then marked Closed.");
    expect(p.before).toEqual({ id: PL, status: "Next follow up", updated_at: "2026-10-14T08:00:00+00:00" });

    const res = await convert.execute(n.values, ctx, { actionId: "a", origin: "" });
    const lead = await lastJson(routes.leadsPost);
    expect(lead.body).toMatchObject({
      business_name: "Jumbo's Pizza",
      owner_name: "Sam",
      business_phone: "(252) 401-2775",
      business_email: "owner@jumbos.com",
      business_profile_link: "https://www.google.com/maps/place/Jumbos+Pizza",
      platform: "Google",
      site_type: "Redesign",
      has_service_areas: true,
      service_areas: ["Raleigh", "Cary"],
      services: ["Pizza", "Catering"],
      comments: "Wants a new menu page",
      agent_id: ME,
      closed_by: ME,
      status: "Not Ready",
      price_quoted: 500,
      override: false,
    });
    const closed = await lastJson(routes.preLeadPatch);
    expect(new URL(closed.req.url).pathname).toBe(`/api/pre-leads/${PL}`);
    expect(closed.body).toEqual({ status: "Closed" });
    expect(res.data).toEqual({ id: "55555555-5555-4555-8555-555555555555", kind: "lead", pre_lead: PL, pre_lead_closed: true });

    db.tables.leads.push({ id: "55555555-5555-4555-8555-555555555555", created_by: ME, deleted_at: null });
    const msg = await convert.undo!.run(stored(convert, n.values, p.before, res), ctx);
    expect(msg).toBe("the lead was removed again, and the pre-lead is Next follow up again.");
    expect(db.writes.find((w) => w.table === "leads")).toMatchObject({ op: "update", where: { id: "55555555-5555-4555-8555-555555555555" } });
    expect((await lastJson(routes.preLeadPatch)).body).toEqual({ status: "Next follow up" });
  });

  it("keeps the new lead when the pre-lead cannot be closed, and says so", async () => {
    routes.preLeadPatch.mockImplementation(async () => Response.json({ error: "Forbidden" }, { status: 403 }));
    const { ctx } = setup(PERMS, { pre_leads: [preLead()] });
    const n = await normalizeFields(convert, { pre_lead: PL, ...REST }, ctx);
    Object.assign(n.values, (await convert.check!(n.values, ctx))?.values);
    const res = await convert.execute(n.values, ctx, { actionId: "a", origin: "" });
    expect(res.message).toBe("Created the lead Jumbo's Pizza from the pre-lead. The pre-lead could not be marked Closed (Forbidden) — close it in Pre-leads.");
    expect(res.data?.pre_lead_closed).toBe(false);
  });
});
