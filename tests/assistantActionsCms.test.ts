// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CMS_ACTIONS } from "@/lib/assistant/actions/defs/cms";
import { missingFields, normalizeFields } from "@/lib/assistant/actions/fields";
import { riskOf } from "@/lib/assistant/actions/run";
import type { ActionContext, ActionDef, StoredAction, Values } from "@/lib/assistant/actions/types";

/**
 * Agency website actions. The CMS's PUT replaces the whole row, so an edit
 * must send the row as it is with only the said fields changed — and every
 * payload must pass the endpoint's own schema before it is proposed.
 */

const h = vi.hoisted(() => ({ leadPatch: vi.fn(), collectionPost: vi.fn(), rowPut: vi.fn(), rowDelete: vi.fn() }));
vi.mock("@/app/api/website/leads/[id]/route", () => ({ PATCH: h.leadPatch }));
vi.mock("@/app/api/website/[collection]/route", () => ({ POST: h.collectionPost }));
vi.mock("@/app/api/website/[collection]/[id]/route", () => ({ PUT: h.rowPut, DELETE: h.rowDelete }));
// run.ts (for riskOf) pulls in the store and the registry; neither is used here.
vi.mock("@/lib/assistant/actions/registry", () => ({ getActionDef: () => undefined }));
vi.mock("@/lib/assistant/actions/store", () => ({}));
vi.mock("@/lib/assistant/actions/people", () => ({}));

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>, writes: { table: string; patch: Row }[] = []) {
  const like = (v: unknown, p: string) => new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i").test(String(v ?? ""));
  return {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let limit: number | null = null;
      let single = false;
      let patch: Row | null = null;
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        order: () => b,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
        ilike: (c: string, p: string) => (filters.push((r) => like(r[c], p)), b),
        or: (expr: string) => {
          const parts = expr.split(",").map((s) => s.split("."));
          filters.push((r) => parts.some(([c, op, ...v]) => (op === "ilike" ? like(r[c], v.join(".")) : String(r[c]) === v.join("."))));
          return b;
        },
        limit: (n: number) => ((limit = n), b),
        maybeSingle: () => ((single = true), b),
        update: (p: Row) => ((patch = p), b),
        then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
          const hits = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
          if (patch) {
            for (const r of hits) Object.assign(r, patch);
            writes.push({ table, patch });
          }
          // Like a real query: fresh objects every time.
          let rows = hits.map((r) => structuredClone(r));
          if (limit !== null) rows = rows.slice(0, limit);
          return Promise.resolve(single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null }).then(resolve, reject);
        },
      });
      return b;
    },
  } as unknown as SupabaseClient;
}

const ME = "aaaaaaaa-0000-4000-8000-000000000001";
const ENQUIRY = "11111111-1111-4111-8111-111111111111";
const COUPON = "22222222-2222-4222-8222-222222222222";
const OFFER = "33333333-3333-4333-8333-333333333333";
const QUOTE_A = "44444444-4444-4444-8444-444444444444";
const QUOTE_B = "55555555-5555-4555-8555-555555555555";
const SERVICE = "66666666-6666-4666-8666-666666666666";

function fixtures(): Record<string, Row[]> {
  return {
    website_leads: [
      { id: ENQUIRY, name: "Jo Client", email: "jo@client.com", status: "new", notes: "Wants a quote.", is_spam: false, spam_reason: null, contacted_at: null, assigned_to: null, submitted_at: "2026-10-13T10:00:00Z", updated_at: "2026-10-13T10:00:00Z" },
    ],
    website_coupons: [
      { id: COUPON, code: "FALL20", label: "20% off", discount_type: "percent", amount: 20, service_slugs: ["web-design"], active: true, expires_at: null, updated_at: "2026-10-01T00:00:00Z" },
    ],
    website_services: [
      { id: SERVICE, slug: "web-design", name: "Web Design", short_name: "", tagline: "", description: "", icon: "globe", features: ["Fast"], tiers: [{ name: "Starter", price: 499, priceNote: "", billingNote: "", features: [] }], quote_based: false, starting_at: null, market_comparison: { label: "", marketPrice: "", ourPrice: "" }, faqs: [], pain_heading: "Sound familiar?", pains: [], included: [], sort_order: 0, active: true, updated_at: "2026-10-01T00:00:00Z" },
      { id: "s2", slug: "local-seo", name: "Local SEO" },
    ],
    website_offers: [{ id: OFFER, title: "Fall special", banner_text: "Websites from $399", service_slug: null, active: false, sort_order: 0, updated_at: "2026-10-01T00:00:00Z" }],
    website_testimonials: [
      { id: QUOTE_A, client_name: "Ali Raza", business: "Raza Roofing", quote: "Great work, fast.", rating: 5, approved: true, sort_order: 0, updated_at: "2026-10-01T00:00:00Z" },
      { id: QUOTE_B, client_name: "Ali Raza", business: "Raza Plumbing", quote: "Very happy.", rating: 4, approved: false, sort_order: 1, updated_at: "2026-10-01T00:00:00Z" },
    ],
    website_portfolio: [],
  };
}

function ctxFor(over: Partial<ActionContext> = {}, tables = fixtures(), writes: { table: string; patch: Row }[] = []): ActionContext {
  const db = fakeDb(tables, writes);
  return { userId: ME, displayName: "Sam Khan", perms: new Set(["website.manage"]), db, admin: db, timezone: "Asia/Karachi", now: new Date("2026-10-14T07:00:00Z"), isAdmin: false, ...over };
}

const def = (key: string): ActionDef => CMS_ACTIONS.find((x) => x.key === key)!;
const INFO = { actionId: "act-1", origin: "https://dashboard.example" };
const json = (body: unknown, status = 200) => Response.json(body, { status });

async function propose(d: ActionDef, raw: Values, ctx: ActionContext) {
  const n = await normalizeFields(d, raw, ctx);
  const missing = missingFields(d, n.values, n.problems).map((f) => f.name);
  const r = (await d.check?.(n.values, ctx)) ?? {};
  Object.assign(n.values, r.values ?? {});
  return { values: n.values, missing, problems: [...n.problems, ...(r.problems ?? [])], warnings: r.warnings ?? [] };
}

/** A done action as the store keeps it, for undo. */
function stored(input: Values, before: unknown, data: Record<string, unknown>): StoredAction {
  return { input, before_state: before, result: { message: "", data } } as unknown as StoredAction;
}

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
});

describe("who may", () => {
  it("needs Manage Website CMS for every website change, like the endpoints", () => {
    expect(CMS_ACTIONS.map((x) => x.key)).toEqual(["cms.lead", "cms.coupon", "cms.offer", "cms.testimonial", "cms.portfolio", "cms.service"]);
    const viewer = ctxFor({ perms: new Set(["website.view"]) });
    for (const d of CMS_ACTIONS) {
      expect(d.allowed(viewer)).toBe("Your account doesn't have “Manage Website CMS”.");
      expect(d.allowed(ctxFor())).toBeNull();
    }
  });
});

describe("cms.lead", () => {
  const d = def("cms.lead");

  it("asks what to change, and refuses a change that is no change", async () => {
    const ctx = ctxFor();
    const bare = await propose(d, { lead: ENQUIRY }, ctx);
    expect(bare.problems).toEqual([{ field: "_", message: "Say what to change: the status, a note, or spam." }]);
    const same = await propose(d, { lead: ENQUIRY, status: "New" }, ctx);
    expect(same.problems).toEqual([{ field: "status", message: "It is already New." }]);
  });

  it("previews the change and the endpoint's own stamp on first contact", async () => {
    const ctx = ctxFor();
    const p = await propose(d, { lead: "jo@client.com", status: "contacted", add_note: "Called — sending a quote Friday." }, ctx);
    expect(p.problems).toEqual([]);
    const card = await d.preview!(p.values, ctx);
    expect(card.title).toBe("Jo Client: New → Contacted");
    expect(card.changes).toEqual([
      { label: "Status", from: "New", to: "Contacted" },
      { label: "Notes", from: "Wants a quote.", to: "…Called — sending a quote Friday." },
    ]);
    expect(card.notes).toEqual(["This is the first time it leaves New, so it is stamped as contacted now and assigned to you."]);
  });

  it("patches status and the appended notes, and undo puts everything back — the stamp included", async () => {
    const tables = fixtures();
    const writes: { table: string; patch: Row }[] = [];
    const ctx = ctxFor({}, tables, writes);
    // The endpoint stamps first contact itself; the fake does the same.
    const bodies: unknown[] = [];
    h.leadPatch.mockImplementation(async (req: Request) => {
      const body = await req.json();
      bodies.push(body);
      Object.assign(tables.website_leads[0], body, { contacted_at: "2026-10-14T07:00:01Z", assigned_to: ME });
      return json({ ok: true });
    });
    const p = await propose(d, { lead: ENQUIRY, status: "contacted", add_note: "Called." }, ctx);
    const card = await d.preview!(p.values, ctx);
    const before = structuredClone(card.before);
    const out = await d.execute(p.values, ctx, INFO);
    const [req, routeCtx] = h.leadPatch.mock.calls[0] as [Request, { params: Promise<Record<string, string>> }];
    expect(await routeCtx.params).toEqual({ id: ENQUIRY });
    expect(new URL(req.url).pathname).toBe(`/api/website/leads/${ENQUIRY}`);
    expect(bodies[0]).toEqual({ status: "contacted", notes: "Wants a quote.\nCalled." });
    expect(out).toMatchObject({ message: "Jo Client is now Contacted.", data: { stamped: true, fields: ["status", "notes"] } });

    h.leadPatch.mockImplementation(async () => json({ ok: true }));
    await d.undo!.run(stored(p.values, before, out.data!), ctx);
    expect(await (h.leadPatch.mock.calls[1][0] as Request).json()).toEqual({ status: "new", notes: "Wants a quote." });
    expect(writes).toEqual([{ table: "website_leads", patch: { contacted_at: null, assigned_to: null } }]);
  });

  it("refuses to confirm over a newer change", async () => {
    const tables = fixtures();
    const ctx = ctxFor({}, tables);
    const p = await propose(d, { lead: ENQUIRY, is_spam: true }, ctx);
    // Stored with the proposal (as JSON), so later edits to the row do not reach it.
    const before = structuredClone((await d.preview!(p.values, ctx)).before);
    expect(await d.stale!(before, p.values, ctx)).toBeNull();
    tables.website_leads[0].updated_at = "2026-10-14T08:00:00Z";
    expect(await d.stale!(before, p.values, ctx)).toBe("it was changed by someone else after this was proposed.");
  });
});

describe("cms.coupon", () => {
  const d = def("cms.coupon");

  it("needs a code and an amount to create one; a coupon to change one", async () => {
    const ctx = ctxFor();
    const n = await normalizeFields(d, { operation: "create" }, ctx);
    expect(missingFields(d, n.values, n.problems).map((f) => f.name)).toEqual(["code", "amount"]);
    const u = await normalizeFields(d, { operation: "Deactivate" }, ctx);
    expect(missingFields(d, u.values, u.problems).map((f) => f.name)).toEqual(["coupon"]);
  });

  it("says what the endpoint would refuse: a taken code, a malformed one", async () => {
    const ctx = ctxFor();
    const taken = await propose(d, { operation: "Create", code: "fall20", amount: 10 }, ctx);
    expect(taken.problems).toEqual([{ field: "code", message: "There is already a coupon FALL20." }]);
    const bad = await propose(d, { operation: "Create", code: "SAVE 10!", amount: 10 }, ctx);
    expect(bad.problems).toEqual([{ field: "code", message: "Code: letters, digits, dashes and underscores" }]);
  });

  it("creates through the coupons endpoint, valid through the end of its last day (company time)", async () => {
    h.collectionPost.mockImplementation(async () => json({ id: "c-new", publish: null }, 201));
    const ctx = ctxFor();
    const p = await propose(d, { operation: "Create", code: "save15", amount: 15, label: "15% off", service_slugs: "web-design", expires_on: "2026-10-31" }, ctx);
    expect(p.problems).toEqual([]);
    expect(riskOf(d, p.values)).toBe("sensitive");
    const card = await d.preview!(p.values, ctx);
    expect(card.title).toBe("New coupon SAVE15 — 15% off (15% off)");
    const out = await d.execute(p.values, ctx, INFO);
    const [req, routeCtx] = h.collectionPost.mock.calls[0] as [Request, { params: Promise<Record<string, string>> }];
    expect(new URL(req.url).pathname).toBe("/api/website/coupons");
    expect(await routeCtx.params).toEqual({ collection: "coupons" });
    expect(await req.json()).toEqual({
      code: "SAVE15",
      label: "15% off",
      discount_type: "percent",
      amount: 15,
      service_slugs: ["web-design"],
      active: true,
      expires_at: "2026-10-31T18:59:59.000Z", // 23:59:59 in Karachi (UTC+5)
    });
    expect(out.data).toEqual({ id: "c-new", kind: "coupon" });

    h.rowDelete.mockImplementation(async () => json({ ok: true, publish: null }));
    await d.undo!.run(stored(p.values, null, out.data!), ctx);
    expect(new URL((h.rowDelete.mock.calls[0][0] as Request).url).pathname).toBe("/api/website/coupons/c-new");
  });

  it("switches one off by sending the whole row with active false, and undo sends it back", async () => {
    h.rowPut.mockImplementation(async () => json({ ok: true, publish: null }));
    const ctx = ctxFor();
    const p = await propose(d, { operation: "Deactivate", coupon: "FALL20" }, ctx);
    expect(p.problems).toEqual([]);
    const card = await d.preview!(p.values, ctx);
    expect(card.changes).toEqual([{ label: "Active", from: "Yes", to: "No" }]);
    const out = await d.execute(p.values, ctx, INFO);
    const [req, routeCtx] = h.rowPut.mock.calls[0] as [Request, { params: Promise<Record<string, string>> }];
    expect(await routeCtx.params).toEqual({ collection: "coupons", id: COUPON });
    const full = { code: "FALL20", label: "20% off", discount_type: "percent", amount: 20, service_slugs: ["web-design"], expires_at: null };
    expect(await req.json()).toEqual({ ...full, active: false });
    await d.undo!.run(stored(p.values, card.before, out.data!), ctx);
    expect(await (h.rowPut.mock.calls[1][0] as Request).json()).toEqual({ ...full, active: true });
  });

  it("will not switch off what is already off", async () => {
    const tables = fixtures();
    tables.website_coupons[0].active = false;
    const p = await propose(d, { operation: "Deactivate", coupon: COUPON }, ctxFor({}, tables));
    expect(p.problems).toEqual([{ field: "coupon", message: "FALL20 is already switched off." }]);
  });
});

describe("website content", () => {
  it("offers: a new one is saved switched off (standard) unless shown now (sensitive)", async () => {
    const d = def("cms.offer");
    const ctx = ctxFor();
    const n = await normalizeFields(d, { operation: "Create" }, ctx);
    expect(missingFields(d, n.values, n.problems).map((f) => f.name)).toEqual(["title"]);
    const hidden = await propose(d, { operation: "Create", title: "Winter deal", service_slug: "none" }, ctx);
    expect(hidden.problems).toEqual([]);
    expect(riskOf(d, hidden.values)).toBe("standard");
    const shown = await propose(d, { operation: "Create", title: "Winter deal", active: true }, ctx);
    expect(riskOf(d, shown.values)).toBe("sensitive");

    h.collectionPost.mockImplementation(async () => json({ id: "o-new", publish: { ok: true, tags: ["offers"] } }, 201));
    const out = await d.execute(hidden.values, ctx, INFO);
    expect(await (h.collectionPost.mock.calls[0][0] as Request).json()).toEqual({ title: "Winter deal", service_slug: null });
    expect(await (h.collectionPost.mock.calls[0][1] as { params: Promise<unknown> }).params).toEqual({ collection: "offers" });
    expect(out.message).toBe("Added the offer “Winter deal”. The live site is updating now.");
  });

  it("edits send the whole row with only the said fields changed", async () => {
    const d = def("cms.offer");
    const ctx = ctxFor();
    h.rowPut.mockImplementation(async () => json({ ok: true, publish: { ok: false, error: "Publish hook not configured" } }));
    const p = await propose(d, { operation: "Update", item: "fall special", banner_text: "Websites from $349" }, ctx);
    expect(p.problems).toEqual([]);
    expect(p.values.item_id).toBe(OFFER);
    const card = await d.preview!(p.values, ctx);
    expect(card.changes).toEqual([{ label: "Banner text", from: "Websites from $399", to: "Websites from $349" }]);
    const out = await d.execute(p.values, ctx, INFO);
    expect(await (h.rowPut.mock.calls[0][0] as Request).json()).toEqual({ title: "Fall special", banner_text: "Websites from $349", service_slug: null, active: false, sort_order: 0 });
    expect(out.message).toContain("The live site was not told (Publish hook not configured)");
  });

  it("testimonials: asks which one when a name matches several, and checks the endpoint's bounds", async () => {
    const d = def("cms.testimonial");
    const ctx = ctxFor();
    const which = await propose(d, { operation: "Update", item: "Ali Raza", approved: true }, ctx);
    expect(which.problems[0]).toMatchObject({ field: "item", message: '"Ali Raza" matches 2 testimonials — which one?' });
    expect(which.problems[0].choices).toEqual([`Ali Raza — “Great work, fast.” [id ${QUOTE_A}]`, `Ali Raza — “Very happy.” [id ${QUOTE_B}]`]);
    const picked = await propose(d, { operation: "Update", item: QUOTE_B, approved: true }, ctx);
    expect(picked.problems).toEqual([]);
    expect(riskOf(d, picked.values)).toBe("sensitive"); // it goes on the public site
    const tooMany = await propose(d, { operation: "Update", item: QUOTE_B, rating: 6 }, ctx);
    expect(tooMany.problems).toContainEqual({ field: "rating", message: "Stars must be at most 5." });
    const n = await normalizeFields(d, { operation: "Create", client_name: "Jo" }, ctx);
    expect(missingFields(d, n.values, n.problems).map((f) => f.name)).toEqual(["quote"]);
  });

  it("services: the slug comes from the name, lists from lines, tiers from JSON — checked by the endpoint's schema", async () => {
    const d = def("cms.service");
    const ctx = ctxFor();
    const p = await propose(
      d,
      { operation: "Create", name: "AI Receptionist", features: "- Answers every call\n- Books appointments", tiers: '[{"name": "Starter", "price": 199, "priceNote": "/mo"}]', active: false },
      ctx,
    );
    expect(p.problems).toEqual([]);
    const card = await d.preview!(p.values, ctx);
    expect(card.title).toBe("New service: AI Receptionist");
    expect(card.fields?.find((f) => f.name === "tiers")?.value).toBe("Starter $199/mo");
    h.collectionPost.mockImplementation(async () => json({ id: "s-new", publish: null }, 201));
    await d.execute(p.values, ctx, INFO);
    expect(await (h.collectionPost.mock.calls[0][0] as Request).json()).toEqual({
      name: "AI Receptionist",
      slug: "ai-receptionist",
      pain_heading: "Sound familiar?",
      features: ["Answers every call", "Books appointments"],
      tiers: [{ name: "Starter", price: 199, priceNote: "/mo" }],
      active: false,
    });

    const taken = await propose(d, { operation: "Create", name: "Web design" }, ctx);
    expect(taken.problems).toEqual([{ field: "slug", message: "There is already a service page at /services/web-design." }]);
    const badTier = await propose(d, { operation: "Create", name: "Ads", tiers: [{ name: "Starter" }] }, ctx);
    expect(badTier.problems).toEqual([{ field: "tiers", message: expect.stringContaining("Pricing tiers (0 › price)") }]);
  });

  it("undo of an edit puts the previous row back; undo of a new entry deletes it", async () => {
    const d = def("cms.offer");
    const ctx = ctxFor();
    h.rowPut.mockImplementation(async () => json({ ok: true, publish: null }));
    const p = await propose(d, { operation: "Update", item: OFFER, active: true }, ctx);
    const before = structuredClone((await d.preview!(p.values, ctx)).before);
    await d.undo!.run(stored(p.values, before, { id: OFFER }), ctx);
    expect(await (h.rowPut.mock.calls[0][0] as Request).json()).toEqual({ title: "Fall special", banner_text: "Websites from $399", service_slug: null, active: false, sort_order: 0 });
  });
});
