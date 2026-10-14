// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MONEY_ACTIONS } from "@/lib/assistant/actions/defs/money";
import { missingFields, normalizeFields } from "@/lib/assistant/actions/fields";
import { RouteError } from "@/lib/assistant/actions/invoke";
import type { ActionContext, ActionDef, Values } from "@/lib/assistant/actions/types";

/**
 * Money actions: receipts and contracts. What matters: the endpoint's own
 * refusals are said before confirming, a receipt starts from the lead the
 * way the Receipt form does, and execute sends the screens' own payload.
 */

const routes = vi.hoisted(() => ({
  receipts: vi.fn(),
  receiptSend: vi.fn(),
  contracts: vi.fn(),
  contractSend: vi.fn(),
}));
vi.mock("@/app/api/leads/[id]/receipts/route", () => ({ POST: routes.receipts }));
vi.mock("@/app/api/receipts/[id]/send/route", () => ({ POST: routes.receiptSend }));
vi.mock("@/app/api/contracts/route", () => ({ POST: routes.contracts }));
vi.mock("@/app/api/contracts/[id]/send/route", () => ({ POST: routes.contractSend }));
// No DNS in tests: deliverability checks say nothing.
vi.mock("@/lib/assistant/actions/checks", () => ({ checkEmail: vi.fn(async () => ({ problems: [], warnings: [], notes: [] })) }));

type Row = Record<string, unknown>;

/** A chainable stand-in for supabase-js over fixture rows (selects ignore columns). */
function fakeDb(tables: Record<string, Row[]>) {
  const like = (v: unknown, p: string) => new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i").test(String(v ?? ""));
  return {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let limit: number | null = null;
      let single = false;
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        order: () => b,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
        ilike: (c: string, p: string) => (filters.push((r) => like(r[c], p)), b),
        or: (expr: string) => {
          const parts = expr.split(",").map((s) => s.split("."));
          filters.push((r) => parts.some(([c, op, ...v]) => (op === "ilike" ? like(r[c], v.join(".")) : String(r[c]) === v.join("."))));
          return b;
        },
        limit: (n: number) => ((limit = n), b),
        maybeSingle: () => ((single = true), b),
        then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
          let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).map((r) => structuredClone(r));
          if (limit !== null) rows = rows.slice(0, limit);
          return Promise.resolve(single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null }).then(resolve, reject);
        },
      });
      return b;
    },
  } as unknown as SupabaseClient;
}

const ME = "aaaaaaaa-0000-4000-8000-000000000001";
const LEAD = "11111111-1111-4111-8111-111111111111";
const BARE_LEAD = "22222222-2222-4222-8222-222222222222";
const RECEIPT = "33333333-3333-4333-8333-333333333333";
const DRAFT = "44444444-4444-4444-8444-444444444444";
const SENT = "55555555-5555-4555-8555-555555555555";
const MY_BOX = "66666666-6666-4666-8666-666666666666";
const BILLING_BOX = "77777777-7777-4777-8777-777777777777";

function fixtures(): Record<string, Row[]> {
  return {
    leads: [
      {
        id: LEAD,
        business_name: "Jumbo's Pizza",
        owner_name: "Sam Jumbo",
        business_email: "Owner@Jumbos.com",
        no_email: false,
        business_phone: "(252) 401-2775",
        site_type: "Custom Website",
        num_webpages: 5,
        price_quoted: 549,
        yearly_price: "$99",
        add_ons: [{ id: "a1", label: "Logo design", price: 50 }],
        status: "Closed",
        agent_id: ME,
        deleted_at: null,
      },
      { id: BARE_LEAD, business_name: "Bare Bakery", owner_name: null, business_email: null, no_email: true, business_phone: null, price_quoted: null, yearly_price: "None", add_ons: null, status: "Ready", agent_id: ME, deleted_at: null },
    ],
    lead_receipts: [
      { id: RECEIPT, lead_id: LEAD, receipt_no: "SED-2026-1013-1001", total: 698, paid_on: "2026-10-13", bill_to_business: "Jumbo's Pizza", bill_to_email: "owner@jumbos.com", sent_to: null, sent_at: null, created_at: "2026-10-13T10:00:00Z" },
    ],
    company_mailboxes: [
      { id: MY_BOX, email_address: "sam@socialexpertdigitalllc.com", display_name: "Sam Khan", user_id: ME, status: "verified", created_at: "2026-01-01T00:00:00Z" },
      { id: BILLING_BOX, email_address: "billing@socialexpertdigitalllc.com", display_name: "SED Billing", user_id: "someone-else", status: "verified", created_at: "2026-01-02T00:00:00Z" },
    ],
    app_settings: [{ singleton: true, receipt_signer_name: "Milton Spi", receipt_mailbox_id: null }],
    contract_templates: [],
    contracts: [
      { id: DRAFT, lead_id: LEAD, business_name: "Jumbo's Pizza", status: "draft", recipient_email: "owner@jumbos.com", mailbox_id: MY_BOX, one_time_price: 499, yearly_price: 99, sent_at: null, created_at: "2026-10-12T09:00:00Z" },
      { id: SENT, lead_id: LEAD, business_name: "Jumbo's Pizza", status: "sent", recipient_email: "owner@jumbos.com", mailbox_id: MY_BOX, one_time_price: 549, yearly_price: 99, sent_at: "2026-10-10T09:00:00Z", created_at: "2026-10-10T08:00:00Z" },
    ],
    profiles: [{ id: ME, display_name: "Sam Khan", email: "sam@socialexpertdigitalllc.com" }],
  };
}

function ctxFor(over: Partial<ActionContext> = {}, tables = fixtures()): ActionContext {
  const db = fakeDb(tables);
  return {
    userId: ME,
    displayName: "Sam Khan",
    perms: new Set(["receipts.send", "contracts.send"]),
    db,
    admin: db,
    timezone: "Asia/Karachi",
    now: new Date("2026-10-14T07:00:00Z"),
    isAdmin: false,
    ...over,
  };
}

const def = (key: string): ActionDef => MONEY_ACTIONS.find((d) => d.key === key)!;
const INFO = { actionId: "act-1", origin: "https://dashboard.example" };

/** What prepare_action does before a card exists: normalise, count what is missing, run the check. */
async function propose(d: ActionDef, raw: Values, ctx: ActionContext) {
  const n = await normalizeFields(d, raw, ctx);
  const missing = missingFields(d, n.values, n.problems).map((f) => f.name);
  const r = (await d.check?.(n.values, ctx)) ?? {};
  Object.assign(n.values, r.values ?? {});
  return { values: n.values, missing, problems: [...n.problems, ...(r.problems ?? [])], warnings: r.warnings ?? [] };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

beforeEach(() => {
  for (const fn of Object.values(routes)) fn.mockReset();
});

describe("who may", () => {
  it("refuses receipts and contracts without the endpoints' permissions", () => {
    const none = ctxFor({ perms: new Set() });
    expect(def("receipt.create").allowed(none)).toBe("Your account doesn't have “Create & Send Payment Receipts”.");
    expect(def("receipt.send").allowed(none)).toBe("Your account doesn't have “Create & Send Payment Receipts”.");
    expect(def("contract.draft").allowed(none)).toBe("Your account doesn't have “Create & Send Contracts”.");
    expect(def("contract.send").allowed(none)).toBe("Your account doesn't have “Create & Send Contracts”.");
    for (const d of MONEY_ACTIONS) expect(d.allowed(ctxFor())).toBeNull();
  });
});

describe("receipt.create", () => {
  const d = def("receipt.create");

  it("asks only for the lead and how the client paid (the date defaults to today)", async () => {
    const ctx = ctxFor();
    const empty = await normalizeFields(d, {}, ctx);
    expect(missingFields(d, empty.values, empty.problems).map((f) => f.name)).toEqual(["lead", "payment_method"]);
    const some = await normalizeFields(d, { lead: LEAD }, ctx);
    expect(missingFields(d, some.values, some.problems).map((f) => f.name)).toEqual(["payment_method"]);
    expect(some.values.paid_on).toBe("2026-10-14"); // today in Karachi
  });

  it("starts from the lead like the Receipt form: bill-to, its prices as lines, suggested notes", async () => {
    const p = await propose(d, { lead: LEAD, payment_method: "zelle" }, ctxFor());
    expect(p.missing).toEqual([]);
    expect(p.problems).toEqual([]);
    expect(p.values).toMatchObject({
      payment_method: "Zelle",
      bill_to_name: "Sam Jumbo",
      bill_to_business: "Jumbo's Pizza",
      bill_to_email: "owner@jumbos.com",
      bill_to_phone: "(252) 401-2775",
      project_title: "Digital Services Package",
    });
    expect((p.values.items as { title: string; term: string; rate: number }[]).map((i) => [i.title, i.term, i.rate])).toEqual([
      ["Custom Website Development", "one_time", 549],
      ["Domain, Hosting & Maintenance", "yearly", 99],
      ["Logo design", "one_time", 50],
    ]);
    expect(String(p.values.notes)).toContain("Next renewal on October 14, 2027");
    // An earlier receipt on the lead is pointed out, not blocked.
    expect(p.warnings.join(" ")).toContain("SED-2026-1013-1001");
  });

  it("shows the lines, the total and the values it filled in on the card", async () => {
    const ctx = ctxFor();
    const p = await propose(d, { lead: LEAD, payment_method: "Zelle", discount: 48 }, ctx);
    const card = await d.preview!(p.values, ctx);
    expect(card.title).toBe("Receipt for Jumbo's Pizza — $650.00 paid via Zelle");
    const rows = Object.fromEntries((card.fields ?? []).map((f) => [f.label, f.value]));
    expect(rows["Service 2"]).toBe("Domain, Hosting & Maintenance (Yearly) — $99.00");
    expect(rows["Total paid"]).toBe("$650.00 (subtotal $698.00, discount −$48.00)");
    // Values the check worked out read on the card like anything the person said.
    expect(rows["Bill-to email"]).toBe("owner@jumbos.com");
    expect(rows.Lead).toBe("Jumbo's Pizza");
    expect(card.notes?.join(" ")).toContain("Signed by Milton Spi");
  });

  it("asks what was paid when the lead has no price, and warns when it is not Closed", async () => {
    const p = await propose(d, { lead: BARE_LEAD, payment_method: "Cash" }, ctxFor());
    expect(p.problems).toEqual([expect.objectContaining({ field: "items", message: expect.stringContaining("has no quoted price") })]);
    expect(p.warnings.join(" ")).toContain("is Ready, not Closed");
  });

  it("takes services as people say them: a known service brings its term and description", async () => {
    const p = await propose(d, { lead: LEAD, payment_method: "Stripe", items: [{ title: "Google Business Profile & Local SEO", price: "$200" }, { title: "Rush fee", rate: 25, qty: 2 }] }, ctxFor());
    expect(p.problems).toEqual([]);
    expect(p.values.items).toEqual([
      expect.objectContaining({ title: "Google Business Profile & Local SEO", term: "monthly", qty: 1, rate: 200, description: expect.stringContaining("Google Business Profile") }),
      { title: "Rush fee", description: "", term: "one_time", qty: 2, rate: 25 },
    ]);
    const bad = await propose(d, { lead: LEAD, payment_method: "Stripe", items: [{ title: "Website", rate: 100, term: "weekly" }] }, ctxFor());
    expect(bad.problems[0]).toMatchObject({ field: "items", message: expect.stringContaining("one_time, monthly or yearly") });
    const zero = await propose(d, { lead: LEAD, payment_method: "Stripe", items: [{ title: "Website", rate: 100 }], discount: 100 }, ctxFor());
    expect(zero.problems[0]).toMatchObject({ field: "items", message: "The total paid must be more than $0." });
  });

  it("keeps suggested notes in step with the paid date until they are edited by hand", async () => {
    const ctx = ctxFor();
    const first = await propose(d, { lead: LEAD, payment_method: "Zelle" }, ctx);
    // The paid date changed on the card: the untouched notes follow it.
    const again = await propose(d, { ...first.values, paid_on: "2026-10-01" }, ctx);
    expect(String(again.values.notes)).toContain("October 1, 2027");
    // Notes written by hand stay as written.
    const edited = await propose(d, { ...first.values, notes: "Paid in full, thank you." }, ctx);
    expect(edited.values.notes).toBe("Paid in full, thank you.");
  });

  it("posts the form's payload to the lead's receipts endpoint and reports the receipt", async () => {
    routes.receipts.mockImplementation(async () => json({ receipt: { id: "r-new", receipt_no: "SED-2026-1014-1002", total: 648 } }, 201));
    const ctx = ctxFor();
    const p = await propose(d, { lead: LEAD, payment_method: "Zelle", payment_reference: "ZL-8842", discount: 50 }, ctx);
    const out = await d.execute(p.values, ctx, INFO);
    const [req, routeCtx] = routes.receipts.mock.calls[0] as [Request, { params: Promise<Record<string, string>> }];
    expect(new URL(req.url).pathname).toBe(`/api/leads/${LEAD}/receipts`);
    expect(await routeCtx.params).toEqual({ id: LEAD });
    const body = await req.json();
    expect(body).toMatchObject({
      bill_to_name: "Sam Jumbo",
      bill_to_business: "Jumbo's Pizza",
      bill_to_email: "owner@jumbos.com",
      project_title: "Digital Services Package",
      discount: 50,
      tax_rate: 0,
      paid_on: "2026-10-14",
      payment_method: "Zelle",
      payment_reference: "ZL-8842",
    });
    expect(body.items).toHaveLength(3);
    expect(body.notes.length).toBeGreaterThan(0);
    expect(out).toMatchObject({ data: { id: "r-new", kind: "receipt" }, message: expect.stringContaining("SED-2026-1014-1002") });
    expect(d.produces).toBe("receipt");
    expect(d.undo).toBeUndefined();
  });
});

describe("receipt.send", () => {
  const d = def("receipt.send");

  it("sends to the bill-to email unless told otherwise, from the billing mailbox", async () => {
    const p = await propose(d, { receipt: RECEIPT }, ctxFor());
    expect(p.problems).toEqual([]);
    expect(p.values).toMatchObject({ to: "owner@jumbos.com", __from: "SED Billing <billing@socialexpertdigitalllc.com>", __no: "SED-2026-1013-1001" });
  });

  it("refuses when no billing mailbox is linked, and says a resend is a resend", async () => {
    const tables = fixtures();
    tables.company_mailboxes = tables.company_mailboxes.filter((m) => m.id !== BILLING_BOX);
    tables.lead_receipts[0] = { ...tables.lead_receipts[0], sent_to: "owner@jumbos.com", sent_at: "2026-10-13T12:00:00Z" };
    const p = await propose(d, { receipt: RECEIPT }, ctxFor({}, tables));
    expect(p.problems).toEqual([expect.objectContaining({ field: "_", message: expect.stringContaining("No billing mailbox is linked") })]);
    expect(p.warnings.join(" ")).toContain("already emailed to owner@jumbos.com");
  });

  it("asks who to send to when the receipt has no email", async () => {
    const tables = fixtures();
    tables.lead_receipts[0] = { ...tables.lead_receipts[0], bill_to_email: null };
    const p = await propose(d, { receipt: RECEIPT }, ctxFor({}, tables));
    expect(p.problems).toEqual([expect.objectContaining({ field: "to", message: expect.stringContaining("has no email address") })]);
  });

  it("posts {to} to the receipt's send endpoint", async () => {
    routes.receiptSend.mockImplementation(async () => json({ receipt: { receipt_no: "SED-2026-1013-1001", lead_id: LEAD } }));
    const ctx = ctxFor();
    const p = await propose(d, { receipt: RECEIPT, to: "Accounts@Jumbos.com" }, ctx);
    const out = await d.execute(p.values, ctx, INFO);
    const [req, routeCtx] = routes.receiptSend.mock.calls[0] as [Request, { params: Promise<Record<string, string>> }];
    expect(new URL(req.url).pathname).toBe(`/api/receipts/${RECEIPT}/send`);
    expect(await routeCtx.params).toEqual({ id: RECEIPT });
    expect(await req.json()).toEqual({ to: "accounts@jumbos.com" });
    expect(out.message).toBe("Emailed receipt SED-2026-1013-1001 to accounts@jumbos.com.");
    expect(d.risk).toBe("sensitive");
    expect(d.undo).toBeUndefined();
  });
});

describe("contract.draft", () => {
  const d = def("contract.draft");

  it("defaults the prices to the lead's, the sender to the person's own mailbox and the template to the built-in one", async () => {
    const p = await propose(d, { lead: LEAD }, ctxFor());
    expect(p.missing).toEqual([]);
    expect(p.problems).toEqual([]);
    expect(p.values).toMatchObject({
      one_time_price: 549,
      yearly_price: 99,
      mailbox: "sam@socialexpertdigitalllc.com",
      __mailbox_id: MY_BOX,
      template: "Website Development Agreement (built in)",
      __template_id: null,
    });
    expect(String(p.values.message_body)).toContain("Please find your website services agreement attached");
    // The earlier contracts on the lead are pointed out.
    expect(p.warnings.join(" ")).toMatch(/already sent to owner@jumbos.com/);
  });

  it("says what the endpoint would refuse: no email on the lead, no price to quote", async () => {
    const p = await propose(d, { lead: BARE_LEAD }, ctxFor());
    expect(p.problems.map((x) => x.field).sort()).toEqual(["lead", "one_time_price"]);
    expect(p.problems.find((x) => x.field === "lead")?.message).toContain("has no email address");
  });

  it("asks which mailbox when the person has none of their own", async () => {
    const tables = fixtures();
    tables.company_mailboxes = tables.company_mailboxes.filter((m) => m.id !== MY_BOX);
    const p = await propose(d, { lead: LEAD }, ctxFor({}, tables));
    expect(p.problems).toEqual([expect.objectContaining({ field: "mailbox", choices: ["billing@socialexpertdigitalllc.com"] })]);
  });

  it("posts the composer's payload, a stated discount included", async () => {
    routes.contracts.mockImplementation(async () => json({ contract: { id: "c-new" } }, 201));
    const ctx = ctxFor();
    const p = await propose(d, { lead: LEAD, one_time_price: "$499", yearly_price: 0, mailbox: "billing@socialexpertdigitalllc.com" }, ctx);
    expect(p.problems).toEqual([]);
    const out = await d.execute(p.values, ctx, INFO);
    const [req] = routes.contracts.mock.calls[0] as [Request];
    expect(await req.json()).toEqual({
      lead_id: LEAD,
      mailbox_id: BILLING_BOX,
      template_key: "standard",
      google_template_id: null,
      message_body: expect.stringContaining("Please find your website services agreement attached"),
      one_time_price: 499,
      yearly_price: 0,
    });
    expect(out).toMatchObject({ data: { id: "c-new", kind: "contract" }, link: { href: "/api/contracts/c-new/pdf" } });
  });

  it("names what the lead is missing when the endpoint refuses", async () => {
    routes.contracts.mockImplementation(async () => json({ error: "Missing required fields", missing: ["Business email"] }, 422));
    const ctx = ctxFor();
    const p = await propose(d, { lead: LEAD }, ctx);
    const err = await d.execute(p.values, ctx, INFO).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RouteError);
    expect((err as RouteError).message).toBe("Missing required fields: Business email.");
  });
});

describe("contract.send", () => {
  const d = def("contract.send");

  it("refuses a contract that was already sent (the endpoint would)", async () => {
    const p = await propose(d, { contract: SENT }, ctxFor());
    expect(p.problems).toEqual([expect.objectContaining({ field: "contract", message: expect.stringContaining("already sent") })]);
  });

  it("sends a draft through its send endpoint", async () => {
    routes.contractSend.mockImplementation(async () => json({ contract: { recipient_email: "owner@jumbos.com", business_name: "Jumbo's Pizza", lead_id: LEAD } }));
    const ctx = ctxFor();
    const p = await propose(d, { contract: DRAFT }, ctx);
    expect(p.problems).toEqual([]);
    expect(p.values).toMatchObject({ __to: "owner@jumbos.com", __from: "Sam Khan <sam@socialexpertdigitalllc.com>" });
    const preview = await d.preview!(p.values, ctx);
    expect(preview.title).toBe("Send the contract to owner@jumbos.com — Jumbo's Pizza");
    const out = await d.execute(p.values, ctx, INFO);
    const [req, routeCtx] = routes.contractSend.mock.calls[0] as [Request, { params: Promise<Record<string, string>> }];
    expect(new URL(req.url).pathname).toBe(`/api/contracts/${DRAFT}/send`);
    expect(await routeCtx.params).toEqual({ id: DRAFT });
    expect(out.message).toBe("Sent the contract for Jumbo's Pizza to owner@jumbos.com.");
  });

  it("lets a plan send what an earlier step drafts", async () => {
    const ctx = ctxFor();
    const n = await normalizeFields(d, { contract: "@1" }, ctx, { stepRefs: true });
    expect(n.problems).toEqual([]);
    expect((await d.check!(n.values, ctx)) ?? {}).toEqual({});
  });
});
