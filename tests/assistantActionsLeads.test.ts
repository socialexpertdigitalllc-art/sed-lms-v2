// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActionContext } from "@/lib/assistant/actions/types";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";

/**
 * The lead actions: what they require, how they check, and what they send to
 * the app's own endpoints. The endpoints themselves are mocked — what is
 * pinned here is that SED AI asks for every field the New Lead form demands,
 * catches duplicates and dead emails BEFORE the person confirms, and sends
 * the endpoint exactly the payload the form would.
 */

const posted: { url: string; method: string; body: unknown }[] = [];
const respond = (status: number, body: unknown) => Response.json(body, { status });
const capture = (status: number, body: unknown) =>
  vi.fn(async (req: Request) => {
    posted.push({ url: req.url, method: req.method, body: await req.json().catch(() => null) });
    return respond(status, body);
  });

vi.mock("@/app/api/leads/route", () => ({ POST: capture(201, { id: "00000000-0000-4000-8000-0000000000aa" }) }));
vi.mock("@/app/api/leads/[id]/route", () => ({ PATCH: capture(200, { ok: true }), DELETE: capture(200, { ok: true }) }));
vi.mock("@/app/api/leads/[id]/follow-ups/route", () => ({ POST: capture(201, { ok: true }) }));
vi.mock("@/app/api/leads/bulk/route", () => ({ POST: capture(200, { ok: true, updated: 2 }) }));
vi.mock("@/app/api/leads/[id]/tags/route", () => ({ PUT: capture(200, { ok: true }) }));
vi.mock("@/app/api/tags/route", () => ({ POST: capture(201, { tag: { id: "tag-new" } }) }));
vi.mock("@/lib/email-verify", () => ({
  getDomainDns: vi.fn(async (domain: string) => ({ domain, status: domain === "nowhere-xyz.com" ? "nxdomain" : "ok", hasMx: true, nullMx: false, hasAddr: true, checkedAt: "" })),
  parseEmail: (e: string) => ({ domain: e.split("@")[1] ?? "" }),
  suggestEmail: (e: string) => (e.endsWith("@gmial.com") ? e.replace("gmial", "gmail") : null),
}));
vi.mock("@/lib/leads/closedBy", () => ({ isAllowedClosedBy: async () => true, CLOSED_BY_MESSAGE: "Closed by must be yourself or a member of the Closing department." }));

const { LEAD_ACTIONS, leadPayload, socialProfilesFrom } = await import("@/lib/assistant/actions/defs/leads");
const { normalizeFields, missingFields } = await import("@/lib/assistant/actions/fields");

const def = (key: string) => LEAD_ACTIONS.find((d) => d.key === key)!;
let mem: MemoryDb;
const NOW = new Date("2026-10-14T10:00:00Z");
const LEAD_ID = "00000000-0000-4000-8000-000000000001";

function ctx(perms: string[] = ["leads.create", "leads.edit", "leads.status_change", "leads.followup", "leads.cat_set.ready", "leads.cat_set.long_term", "leads.cat_set.dropped", "leads.cat_set.closed"], over: Partial<ActionContext> = {}): ActionContext {
  return { userId: "sam", displayName: "Sam", perms: new Set(perms), db: mem.client, admin: mem.client, timezone: "Asia/Karachi", now: NOW, isAdmin: false, ...over };
}

const complete = {
  business_name: "Jumbo's Pizza",
  business_phone: "252-401-2775",
  business_email: "owner@jumbos.com",
  site_type: "Custom Website",
  platform: "Google",
  business_profile_link: "https://maps.app.goo.gl/abc",
  has_service_areas: "yes",
  service_areas: ["Austin", "Round Rock"],
  services: "Pizza, Catering",
  client_experience: 12,
  specify_pages: ["Home", "About Us", "Contact Us"],
  color_scheme: "#1e40af, #ffffff",
  follow_up_time: "2026-10-15T11:00",
  price_quoted: "$500",
  comments: "Wants a site before the holidays.",
  rating: 8,
  fresh_or_followup: "Fresh",
};

beforeEach(() => {
  posted.length = 0;
  mem = memorySupabase({
    leads: [
      { id: LEAD_ID, business_name: "Old Town Plumbing", business_phone: "(512) 555-0100", business_email: "info@oldtown.com", agent_id: "ali", status: "Ready", website_link: null, deleted_at: null, updated_at: "2026-10-10T00:00:00Z" },
    ],
    profiles: [
      { id: "sam", display_name: "Sam Khan", email: "sam@x.com", is_active: true },
      { id: "ali", display_name: "Ali Raza", email: "ali@x.com", is_active: true },
    ],
    website_addons: [{ id: "a1", label: "Logo design", price: 50, is_active: true, sort: 1 }],
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));
});

async function prepare(key: string, fields: Record<string, unknown>, c = ctx()) {
  const d = def(key);
  const n = await normalizeFields(d, fields, c);
  const missing = missingFields(d, n.values, n.problems);
  const checked = (await d.check?.(n.values, c)) ?? {};
  return { n, missing: missing.map((f) => f.name), problems: [...n.problems, ...(checked.problems ?? [])], warnings: checked.warnings ?? [], values: { ...n.values, ...(checked.values ?? {}) } };
}

describe("lead.create", () => {
  it("asks for every field the New Lead form requires — and only those", async () => {
    const r = await prepare("lead.create", { business_name: "Jumbo's Pizza" });
    expect(r.missing).toEqual([
      "business_phone",
      "business_email",
      "site_type",
      "platform",
      "business_profile_link",
      "has_service_areas",
      "services",
      "client_experience",
      "specify_pages",
      "color_scheme",
      "follow_up_time",
      "price_quoted",
      "comments",
      "rating",
      "fresh_or_followup",
    ]);
  });

  it("does not ask for an email when the business has none, nor for areas when there are none", async () => {
    const r = await prepare("lead.create", { ...complete, business_email: undefined, no_email: true, has_service_areas: "no", service_areas: undefined });
    expect(r.missing).toEqual([]);
    expect(r.problems).toEqual([]);
  });

  it("accepts a complete lead with no problems, and builds the form's own payload", async () => {
    const r = await prepare("lead.create", complete);
    expect(r.missing).toEqual([]);
    expect(r.problems).toEqual([]);
    const payload = await leadPayload(r.values, ctx());
    expect(payload).toMatchObject({
      business_name: "Jumbo's Pizza",
      business_phone: "(252) 401-2775",
      status: "Not Ready",
      agent_id: "sam",
      closed_by: "sam",
      has_service_areas: true,
      service_areas: ["Austin", "Round Rock"],
      services: ["Pizza", "Catering"],
      num_webpages: 3,
      price_quoted: 500,
      yearly_price: "None",
      follow_up_time: "2026-10-15T06:00:00.000Z",
      color_same_as_logo: false,
    });
  });

  it("stops a duplicate before anyone confirms it", async () => {
    const r = await prepare("lead.create", { ...complete, business_phone: "(512) 555-0100" });
    expect(r.problems).toEqual([expect.objectContaining({ field: "business_phone", message: expect.stringMatching(/already in the system.*Ali Raza/) })]);
  });

  it("lets someone allowed to override a duplicate save it anyway, when they say so", async () => {
    const r = await prepare("lead.create", { ...complete, business_phone: "(512) 555-0100", override_duplicate: true }, ctx(["leads.create", "leads.duplicate.override"]));
    expect(r.problems).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/Saving anyway/);
  });

  it("catches an email that cannot receive mail, and a likely typo", async () => {
    const dead = await prepare("lead.create", { ...complete, business_email: "owner@nowhere-xyz.com" });
    expect(dead.problems).toEqual([expect.objectContaining({ field: "business_email", message: expect.stringMatching(/does not exist/) })]);
    const typo = await prepare("lead.create", { ...complete, business_email: "owner@gmial.com" });
    expect(typo.warnings.join(" ")).toMatch(/owner@gmail\.com/);
  });

  it("keeps someone without the assign permission as the lead's agent", async () => {
    const r = await prepare("lead.create", { ...complete, agent: "ali" });
    expect(r.values.agent).toBe("sam");
    expect(r.warnings.join(" ")).toMatch(/will be yours/);
  });

  it("creates the lead through POST /api/leads", async () => {
    const r = await prepare("lead.create", complete);
    const out = await def("lead.create").execute(r.values, ctx(), { actionId: "act-1", origin: "https://app" });
    expect(out.link?.href).toBe("/leads/00000000-0000-4000-8000-0000000000aa");
    expect(posted[0]).toMatchObject({ method: "POST", body: expect.objectContaining({ business_name: "Jumbo's Pizza", override: false }) });
  });
});

describe("other lead actions", () => {
  it("lead.status needs the website link to set Ready", async () => {
    const r = await prepare("lead.status", { lead: LEAD_ID, status: "Ready" }, ctx(["leads.status_change", "leads.cat_set.ready", "leads.view"]));
    expect(r.problems).toEqual([expect.objectContaining({ field: "status", message: expect.stringMatching(/already Ready/) })]);
    mem.tables.leads[0].status = "Not Ready";
    const r2 = await prepare("lead.status", { lead: LEAD_ID, status: "Ready" }, ctx(["leads.status_change", "leads.cat_set.ready"]));
    expect(r2.problems).toEqual([expect.objectContaining({ field: "website_link" })]);
  });

  it("lead.followup needs a next call unless the lead is being dropped, and comments on a pickup", async () => {
    const pickup = await prepare("lead.followup", { lead: LEAD_ID, outcome: "Pickup" });
    expect(pickup.missing).toEqual(["comments", "next_follow_up_time"]);
    const dropped = await prepare("lead.followup", { lead: LEAD_ID, outcome: "Pickup", comments: "Not interested", status_change: "Dropped" });
    expect(dropped.missing).toEqual([]);
    const noPickup = await prepare("lead.followup", { lead: LEAD_ID, outcome: "No Pickup" });
    expect(noPickup.missing).toEqual(["next_follow_up_time"]);
    await def("lead.followup").execute({ ...noPickup.values, next_follow_up_time: "2026-10-15T06:00:00.000Z" }, ctx(), { actionId: "a", origin: "" });
    expect(posted[0].body).toEqual({ fu_status: "No Pickup", comments: null, next_follow_up_time: "2026-10-15T06:00:00.000Z", is_specific_time: false, status_change: null });
  });

  it("lead.update sends only what changes, and needs something to change", async () => {
    const nothing = await prepare("lead.update", { lead: LEAD_ID });
    expect(nothing.problems).toEqual([expect.objectContaining({ field: "_" })]);
    const r = await prepare("lead.update", { lead: LEAD_ID, business_phone: "2524012775" });
    expect(r.problems).toEqual([]);
    await def("lead.update").execute(r.values, ctx(), { actionId: "a", origin: "" });
    expect(posted[0]).toMatchObject({ method: "PATCH", body: { business_phone: "(252) 401-2775" } });
  });

  it("only admins change the rating", async () => {
    const r = await prepare("lead.update", { lead: LEAD_ID, rating: 9 });
    expect(r.problems).toEqual([expect.objectContaining({ field: "rating" })]);
  });

  it("lead.assign is admin-only, like the lead screens", () => {
    expect(def("lead.assign").allowed(ctx(["leads.assign"]))).toMatch(/Admin department/);
    expect(def("lead.assign").allowed(ctx(["leads.assign"], { isAdmin: true }))).toBeNull();
  });

  it("reads social links into the form's platforms", () => {
    expect(socialProfilesFrom(["https://facebook.com/jumbos", "instagram.com/jumbos", "https://linktr.ee/jumbos"])).toEqual([
      { platform: "Facebook", url: "https://facebook.com/jumbos", label: null },
      { platform: "Instagram", url: "instagram.com/jumbos", label: null },
      { platform: "Other", url: "https://linktr.ee/jumbos", label: "linktr.ee" },
    ]);
  });
});
