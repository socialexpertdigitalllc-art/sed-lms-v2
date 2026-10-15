// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cents, DOMAIN_ACTIONS, relativeName, snapshotTime } from "@/lib/assistant/actions/defs/domains";
import { missingFields, normalizeFields } from "@/lib/assistant/actions/fields";
import type { ActionContext, ActionDef, StoredAction, Values } from "@/lib/assistant/actions/types";
import type { DnsRow } from "@/lib/domains/manage";
import type { DomainOffer } from "@/lib/domains/service";
import type { SiteSnapshot } from "@/lib/site-studio/deploy/snapshots";

/**
 * Websites & domains actions over a fake database, with the routes and the
 * registrar / hosting lookups mocked: each action must refuse what its route
 * refuses, ask for what the route needs, show the real price before money is
 * spent, and send the route the request the Domains page / Deployments board
 * sends.
 */

/* ------------------------------------------------------------ route mocks */

const routes = vi.hoisted(() => {
  type Call = { route: string; method: string; url: string; params: Record<string, string>; body: unknown };
  const calls: Call[] = [];
  const replies: Record<string, (call: Call) => Response | Promise<Response>> = {};
  function handler(route: string, method: string) {
    return async (req: Request, ctx: { params: Promise<Record<string, string>> }) => {
      const text = await req.text();
      const call: Call = { route, method, url: req.url, params: await ctx.params, body: text ? JSON.parse(text) : null };
      calls.push(call);
      const reply = replies[`${method} ${route}`];
      return reply ? reply(call) : Response.json({ ok: true });
    };
  }
  return { calls, replies, handler };
});

vi.mock("@/app/api/domains/search/route", () => ({ GET: routes.handler("search", "GET") }));
vi.mock("@/app/api/domains/purchase/route", () => ({ POST: routes.handler("purchase", "POST") }));
vi.mock("@/app/api/domains/[id]/route", () => ({ PATCH: routes.handler("domain", "PATCH") }));
vi.mock("@/app/api/domains/[id]/health/route", () => ({ POST: routes.handler("health", "POST") }));
vi.mock("@/app/api/domains/[id]/dns/route", () => ({ POST: routes.handler("dns", "POST") }));
vi.mock("@/app/api/domains/[id]/dns/reset/route", () => ({ POST: routes.handler("reset", "POST") }));
vi.mock("@/app/api/domains/[id]/forwarding/route", () => ({ PUT: routes.handler("forwarding", "PUT"), DELETE: routes.handler("forwarding", "DELETE") }));
vi.mock("@/app/api/site-studio/deployments/[id]/route", () => ({ DELETE: routes.handler("takedown", "DELETE") }));
vi.mock("@/app/api/site-studio/deployments/link/route", () => ({ POST: routes.handler("link", "POST") }));
vi.mock("@/app/api/site-studio/deployments/restore/route", () => ({ POST: routes.handler("restore", "POST") }));
vi.mock("@/app/api/site-studio/deployments/[id]/transfer/route", () => ({ POST: routes.handler("transfer", "POST") }));

/* --------------------------------------- registrar / hosting lookups (mocked) */

const env = vi.hoisted(() => ({
  cf: true,
  hg: true,
  da: true,
  sandbox: false,
  offers: null as unknown,
  dns: null as unknown,
  forwarding: null as unknown,
  snapshots: null as unknown,
}));
vi.mock("@/lib/domains/service", () => ({ searchOffers: vi.fn(async () => env.offers) }));
vi.mock("@/lib/cloudflare/client", async (orig) => ({ ...(await orig<object>()), cloudflareConfigured: () => env.cf, registrarSandbox: () => env.sandbox }));
vi.mock("@/lib/hostinger/client", async (orig) => ({ ...(await orig<object>()), hostingerConfigured: () => env.hg, getHostingerForwarding: async () => env.forwarding }));
vi.mock("@/lib/domains/manage", async (orig) => ({ ...(await orig<object>()), listDns: vi.fn(async () => env.dns) }));
vi.mock("@/lib/site-studio/deploy/snapshots", async (orig) => ({ ...(await orig<object>()), listSiteSnapshots: vi.fn(async () => env.snapshots) }));
vi.mock("@/lib/template-engine/directadmin", async (orig) => ({ ...(await orig<object>()), daConfigured: () => env.da }));

/* -------------------------------------------------------------- fake db */

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let single = false;
      let limit: number | null = null;
      const b: Record<string, unknown> = {};
      const where = (f: (r: Row) => boolean) => (filters.push(f), b);
      Object.assign(b, {
        select: () => b,
        eq: (c: string, v: unknown) => where((r) => r[c] === v),
        neq: (c: string, v: unknown) => where((r) => r[c] !== v),
        is: (c: string, v: unknown) => where((r) => (r[c] ?? null) === v),
        in: (c: string, vs: unknown[]) => where((r) => vs.includes(r[c])),
        ilike: (c: string, p: string) => where((r) => String(r[c] ?? "").toLowerCase().includes(p.replace(/%/g, "").toLowerCase())),
        or: () => b,
        order: () => b,
        limit: (n: number) => ((limit = n), b),
        maybeSingle: () => ((single = true), b),
        then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
          let hit = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
          if (limit !== null) hit = hit.slice(0, limit);
          return Promise.resolve(single ? { data: hit[0] ?? null, error: null } : { data: hit, error: null }).then(resolve, reject);
        },
      });
      return b;
    },
  } as unknown as SupabaseClient;
}

/* ------------------------------------------------------------- fixtures */

const USER = "00000000-0000-4000-8000-000000000001";
const LEAD = "10000000-0000-4000-8000-000000000001";
const LEAD2 = "10000000-0000-4000-8000-000000000002";
const D1 = "50000000-0000-4000-8000-000000000001"; // jumbospizza.com — Cloudflare, unassigned
const D2 = "50000000-0000-4000-8000-000000000002"; // alisgrill.com — Hostinger, live for Ali's
const S1 = "60000000-0000-4000-8000-000000000001"; // jumbos-pizza.dmviral.com — live staging
const S2 = "60000000-0000-4000-8000-000000000002"; // old-site.dmviral.com — taken down
const S3 = "60000000-0000-4000-8000-000000000003"; // sedlms.com — a protected company domain
const S4 = "60000000-0000-4000-8000-000000000004"; // alisgrill.com — live on a custom domain
const NOW = new Date("2026-10-14T10:00:00Z");

let tables: Record<string, Row[]>;

function fixtures(): Record<string, Row[]> {
  const domain = (over: Row): Row => ({
    registrar: "cloudflare",
    origin: "purchased",
    status: "unassigned",
    lead_id: null,
    registrar_status: "active",
    auto_renew: true,
    hostinger_subscription_id: null,
    expires_at: "2027-10-01T00:00:00Z",
    renewal_cost_cents: 1046,
    currency: "USD",
    leads: null,
    ...over,
  });
  const site = (over: Row): Row => ({ lead_id: null, origin: "builder", status: "live", updated_at: "2026-10-14T09:00:00Z", leads: null, ...over });
  return {
    leads: [
      { id: LEAD, business_name: "Jumbo's Pizza", status: "Ready", agent_id: USER, deleted_at: null, website_link: "https://jumbos-pizza.dmviral.com" },
      { id: LEAD2, business_name: "Ali's Grill", status: "Ready", agent_id: USER, deleted_at: null, website_link: "https://alisgrill.com" },
    ],
    client_domains: [
      domain({ id: D1, domain: "jumbospizza.com" }),
      domain({ id: D2, domain: "alisgrill.com", registrar: "hostinger", status: "live", lead_id: LEAD2, auto_renew: false, hostinger_subscription_id: "sub-1", leads: { business_name: "Ali's Grill" } }),
    ],
    studio_deployments: [
      site({ id: S1, lead_id: LEAD, subdomain: "jumbos-pizza", url: "https://jumbos-pizza.dmviral.com", leads: { business_name: "Jumbo's Pizza" } }),
      site({ id: S2, subdomain: "old-site", url: "https://old-site.dmviral.com", status: "taken_down" }),
      site({ id: S3, subdomain: "sedlms.com", url: "https://sedlms.com", origin: "manual" }),
      site({ id: S4, lead_id: LEAD2, subdomain: "alisgrill.com", url: "https://alisgrill.com", origin: "manual", leads: { business_name: "Ali's Grill" } }),
    ],
    profiles: [],
  };
}

const ALL = ["domains.view", "domains.manage", "domains.purchase", "studio.manage", "tickets.resolve"];

function ctxWith(perms: string[] = ALL): ActionContext {
  const db = fakeDb(tables);
  return { userId: USER, displayName: "Sam", perms: new Set(perms), db, admin: db, timezone: "Asia/Karachi", now: NOW, isAdmin: true };
}

const def = (key: string): ActionDef => {
  const d = DOMAIN_ACTIONS.find((a) => a.key === key);
  if (!d) throw new Error(`no ${key}`);
  return d;
};

async function prepare(key: string, raw: Values, ctx = ctxWith(), opts: { stepRefs?: boolean } = {}) {
  const d = def(key);
  const n = await normalizeFields(d, raw, ctx, opts);
  const checked = d.check ? ((await d.check(n.values, ctx)) ?? {}) : {};
  const values = { ...n.values, ...(checked.values ?? {}) };
  return { d, values, missing: missingFields(d, n.values, n.problems).map((f) => f.name), problems: [...n.problems, ...(checked.problems ?? [])], warnings: checked.warnings ?? [] };
}

async function card(key: string, raw: Values) {
  const p = await prepare(key, raw);
  expect(p.problems).toEqual([]);
  return { ...p, card: await p.d.preview!(p.values, ctxWith()) };
}

async function execute(key: string, raw: Values) {
  const p = await prepare(key, raw);
  expect(p.problems).toEqual([]);
  return p.d.execute(p.values, ctxWith(), { actionId: "act-1", origin: "https://dash.example.com" });
}

const callsTo = (route: string) => routes.calls.filter((c) => c.route === route);
const stored = (input: Values, data: Record<string, unknown>, before: unknown = null) =>
  ({ input, before_state: before, result: { message: "", data } }) as unknown as StoredAction;

const offer = (domain: string, over: Partial<DomainOffer> = {}): DomainOffer => ({
  domain,
  registrar: "cloudflare",
  available: true,
  reason: null,
  registrationCents: 1046,
  renewalCents: 1046,
  currency: "USD",
  ...over,
});

const record = (over: Partial<DnsRow>): DnsRow => ({ id: "r", type: "A", name: "@", content: "", raw: "", ttl: 1, priority: null, proxied: null, editable: true, ...over });
const DNS: DnsRow[] = [
  record({ id: "r1", type: "A", name: "@", content: "1.2.3.4", raw: "1.2.3.4", proxied: false }),
  record({ id: "r2", type: "TXT", name: "@", content: "v=spf1 -all", raw: "v=spf1 -all" }),
  record({ id: "r3", type: "TXT", name: "@", content: "google-site-verification=abc", raw: "google-site-verification=abc" }),
  record({ id: "r4", type: "CNAME", name: "www", content: "jumbospizza.com", raw: "jumbospizza.com", proxied: true }),
];

const snap = (iso: string): SiteSnapshot => {
  const name = `${iso.replace(/[:.]/g, "-")}.zip`;
  return { path: `snapshots/jumbos-pizza.dmviral.com/${name}`, name, takenAt: iso, bytes: 1000 };
};

beforeEach(() => {
  tables = fixtures();
  routes.calls.length = 0;
  for (const k of Object.keys(routes.replies)) delete routes.replies[k];
  Object.assign(env, { cf: true, hg: true, da: true, sandbox: false, offers: null, forwarding: null, snapshots: null });
  env.dns = { ok: true, dns: { rows: DNS.map((r) => ({ ...r })), supportsReset: false, supportsSnapshots: false, supportsProxy: true } };
  process.env.DA_DOMAIN = "dmviral.com";
  process.env.PROTECTED_DOMAINS = "sedlms.com";
});

/* ------------------------------------------------------------------ tests */

describe("who may", () => {
  const PERM_NAMES: Record<string, string> = {
    "domains.purchase": "Your account doesn't have “Buy Domains”.",
    "domains.manage": "Your account doesn't have “Manage Domains”.",
    "studio.manage": "Your account doesn't have “Manage Site Studio (Template Engine v3)”.",
    "domains.view": "Your account doesn't have “View Domains”.",
  };
  const cases: [string, string[], string][] = [
    ["domain.check", ["domains.purchase"], "domains.purchase"],
    ["domain.buy", ["domains.purchase"], "domains.purchase"],
    ["domain.dns", ["domains.manage"], "domains.manage"],
    ["domain.autorenew", ["domains.manage"], "domains.manage"],
    ["site.takedown", ["studio.manage"], "studio.manage"],
    ["site.transfer", ["studio.manage"], "studio.manage"],
    ["domain.health", ["domains.view"], "domains.view"],
    ["site.link", ["domains.manage"], "domains.manage"],
    ["site.restore", ["studio.manage"], "studio.manage"],
  ];
  it.each(cases)("%s is refused without %s, as its route refuses it", (key, perms, first) => {
    expect(def(key).allowed(ctxWith([]))).toBe(PERM_NAMES[first]);
    expect(def(key).allowed(ctxWith(perms))).toBeNull();
  });

  it("routes that admit several permissions admit each of them", () => {
    for (const p of ["domains.view", "domains.manage", "domains.purchase"]) expect(def("domain.health").allowed(ctxWith([p]))).toBeNull();
    for (const p of ["studio.manage", "tickets.resolve"]) expect(def("site.restore").allowed(ctxWith([p]))).toBeNull();
    for (const p of ["domains.manage", "studio.manage"]) expect(def("site.link").allowed(ctxWith([p]))).toBeNull();
    expect(def("domain.buy").allowed(ctxWith(["domains.manage"]))).not.toBeNull();
  });

  it("site.link checks the permission of the path the person picked", async () => {
    // Without any domain permission the domain can't even be named…
    const p = await prepare("site.link", { lead: LEAD, domain: D1 }, ctxWith(["studio.manage"]));
    expect(p.problems).toContainEqual({ field: "domain", message: "Your account can't see domains in the app, so SED AI can't look them up for you." });
    // …and seeing domains is not managing them.
    const viewer = await prepare("site.link", { lead: LEAD, domain: D1 }, ctxWith(["studio.manage", "domains.view"]));
    expect(viewer.problems).toContainEqual({ field: "what", message: "Your account doesn't have “Manage Domains”." });
  });
});

describe("required fields", () => {
  it("domain.buy needs the name and whom it is for (or that it is a stock domain); Cloudflare is the default registrar", async () => {
    const p = await prepare("domain.buy", {});
    expect(p.missing).toEqual(["domain", "lead"]);
    expect(p.values.registrar).toBe("Cloudflare");
    expect((await prepare("domain.buy", { domain: "jumbos.com", stock: "yes" })).missing).toEqual([]);
    const both = await prepare("domain.buy", { domain: "jumbos.com", stock: true, lead: LEAD });
    expect(both.values.lead).toBeUndefined();
  });

  it("domain.dns asks for what each change needs", async () => {
    expect((await prepare("domain.dns", { domain: D1 })).missing).toEqual(["operation"]);
    expect((await prepare("domain.dns", { domain: D1, operation: "Add record" })).missing).toEqual(["type", "content"]);
    expect((await prepare("domain.dns", { domain: D1, operation: "Delete record" })).missing).toEqual(["type"]);
    expect((await prepare("domain.dns", { domain: D2, operation: "Forward domain" })).missing).toEqual(["redirect_url"]);
    expect((await prepare("domain.dns", { domain: D2, operation: "Stop forwarding" })).missing).toEqual([]);
    const add = await prepare("domain.dns", { domain: D1, operation: "add record", type: "a", content: "5.6.7.8" });
    expect(add.values).toMatchObject({ operation: "Add record", type: "A", name: "@" });
  });

  it("domain.dns record types are exactly the ones the DNS route edits", () => {
    const type = def("domain.dns").fields.find((f) => f.name === "type");
    expect(type?.options).toEqual(["A", "AAAA", "CNAME", "ALIAS", "MX", "TXT", "CAA"]);
  });

  it("site.link works out whether a domain or a website is meant, and asks when it cannot", async () => {
    const dom = await prepare("site.link", { lead: LEAD, domain: D1 });
    expect(dom.missing).toEqual([]);
    expect(dom.values.what).toBe("Domain");
    const web = await prepare("site.link", { lead: LEAD2, site: S1 });
    expect(web.values.what).toBe("Website");
    expect((await prepare("site.link", { lead: LEAD })).missing).toEqual(["what"]);
    expect((await prepare("site.link", { lead: LEAD, what: "Website" })).missing).toEqual(["site"]);
  });

  it("the rest need their record (and auto-renew its new state)", async () => {
    expect((await prepare("domain.autorenew", { domain: D1 })).missing).toEqual(["on"]);
    for (const key of ["site.takedown", "site.transfer", "site.restore"]) expect((await prepare(key, {})).missing).toEqual(["site"]);
    expect((await prepare("domain.health", {})).missing).toEqual(["domain"]);
    expect((await prepare("domain.check", {})).missing).toEqual(["query"]);
  });
});

describe("domain.check", () => {
  it("looks the name up through the search route and reports price and alternatives", async () => {
    routes.replies["GET search"] = () =>
      Response.json({ results: [offer("jumbos.com"), offer("jumbos.net", { registrationCents: 1150, renewalCents: 1300 }), offer("jumbos.co", { available: false, reason: "Taken" })] });
    const res = await execute("domain.check", { query: "https://www.Jumbos.com/" });
    const url = new URL(callsTo("search")[0].url);
    expect(url.pathname).toBe("/api/domains/search");
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: "jumbos.com", registrar: "cloudflare" });
    expect(res.message).toBe(
      "jumbos.com is available on Cloudflare: $10.46 for the first year, then $10.46 a year. Also available: jumbos.net ($11.50 first year, renews $13.00).",
    );
  });

  it("refuses an unconfigured registrar, like the route", async () => {
    env.hg = false;
    expect((await prepare("domain.check", { query: "jumbos", registrar: "Hostinger" })).problems).toEqual([{ field: "registrar", message: "Hostinger is not configured." }]);
  });
});

describe("domain.buy", () => {
  it("prices the domain live and shows the exact price on a critical card", async () => {
    env.offers = [offer("jumbos.com", { registrationCents: 1046, renewalCents: 1200 })];
    const { card: c, values } = await card("domain.buy", { domain: "https://www.Jumbos.com/", lead: LEAD });
    expect(values).toMatchObject({ __domain: "jumbos.com", __cents: 1046, __renew_cents: 1200, __lead_name: "Jumbo's Pizza" });
    expect(c.title).toBe("Buy jumbos.com for $10.46 — for Jumbo's Pizza");
    expect(c.fields?.map((f) => [f.label, f.value])).toEqual([
      ["Domain", "jumbos.com"],
      ["Registrar", "Cloudflare"],
      ["First year", "$10.46"],
      ["Renews at", "$12.00 a year, automatically"],
      ["For", "Jumbo's Pizza"],
    ]);
    expect(c.confirmPhrase).toBe("jumbos.com");
    expect(c.warnings?.[0]).toMatch(/can't be refunded/);
    expect(c.before).toEqual({ cents: 1046, domain: "jumbos.com", registrar: "cloudflare" });
    expect(def("domain.buy").risk).toBe("critical");
    expect(def("domain.buy").undo).toBeUndefined();
  });

  it("buys through the purchase route with the price the card showed", async () => {
    env.offers = [offer("jumbos.com")];
    routes.replies["POST purchase"] = () => Response.json({ domain: { id: "d-new", domain: "jumbos.com", status: "purchasing" } });
    const res = await execute("domain.buy", { domain: "jumbos.com", lead: LEAD });
    expect(callsTo("purchase")[0].body).toEqual({ domain: "jumbos.com", registrar: "cloudflare", leadId: LEAD, expectedCents: 1046 });
    expect(res.data).toEqual({ id: "d-new", kind: "domain", cents: 1046 });
    expect(res.message).toMatch(/^Bought jumbos\.com for \$10\.46 on Cloudflare\. It now sets itself up for Jumbo's Pizza/);
    expect(def("domain.buy").produces).toBe("domain");
  });

  it("a stock purchase sends no lead", async () => {
    env.offers = [offer("jumbos.com", { registrar: "hostinger" })];
    routes.replies["POST purchase"] = () => Response.json({ domain: { id: "d-new", domain: "jumbos.com", status: "purchasing" } });
    await execute("domain.buy", { domain: "jumbos.com", registrar: "Hostinger", stock: true });
    expect(callsTo("purchase")[0].body).toEqual({ domain: "jumbos.com", registrar: "hostinger", leadId: null, expectedCents: 1046 });
  });

  it("refuses when the price moved since the card", async () => {
    env.offers = [offer("jumbos.com", { registrationCents: 1199 })];
    const p = await prepare("domain.buy", { domain: "jumbos.com" });
    await expect(p.d.stale!({ cents: 1046 }, p.values, ctxWith())).resolves.toBe(
      "the price changed from $10.46 to $11.99 since this was proposed — nothing was bought.",
    );
    await expect(p.d.stale!({ cents: 1199 }, p.values, ctxWith())).resolves.toBeNull();
    await expect(p.d.stale!({ cents: 1199 }, { ...p.values, __cents: undefined }, ctxWith())).resolves.toMatch(/could not be confirmed/);
  });

  it("never buys without a confirmed price", async () => {
    await expect(def("domain.buy").execute({ domain: "jumbos.com" }, ctxWith(), { actionId: "a", origin: "o" })).rejects.toThrow(/nothing was bought/);
    expect(callsTo("purchase")).toHaveLength(0);
  });

  it("refuses what the purchase route refuses", async () => {
    env.offers = [offer("jumbos.com", { available: false, reason: "Taken" }), offer("jumbospizza.net"), offer("eatjumbos.com", { registrationCents: 899 })];
    const taken = await prepare("domain.buy", { domain: "jumbos.com" });
    expect(taken.problems).toEqual([
      {
        field: "domain",
        message: "jumbos.com can't be bought on Cloudflare: Taken. Available instead: jumbospizza.net ($10.46), eatjumbos.com ($8.99).",
        choices: ["jumbospizza.net", "eatjumbos.com"],
      },
    ]);
    expect((await prepare("domain.buy", { domain: "jumbospizza.com" })).problems).toEqual([
      { field: "domain", message: "jumbospizza.com is already ours (or being bought right now)." },
    ]);
    expect((await prepare("domain.buy", { domain: "x.dmviral.com" })).problems[0].message).toMatch(/staging address/);
    env.offers = [offer("alis.com")];
    expect((await prepare("domain.buy", { domain: "alis.com", lead: LEAD2 })).problems).toEqual([
      { field: "lead", message: "This lead already has the domain alisgrill.com — unlink it first." },
    ]);
    env.offers = null;
    expect((await prepare("domain.buy", { domain: "jumbos.com" })).problems[0].message).toMatch(/Could not confirm/);
    env.cf = false;
    expect((await prepare("domain.buy", { domain: "jumbos.com" })).problems).toContainEqual({ field: "registrar", message: "Cloudflare is not configured." });
    env.cf = true;
    env.hg = false;
    expect((await prepare("domain.buy", { domain: "jumbos.com" })).problems).toContainEqual({ field: "registrar", message: "Hostinger is not configured." });
  });

  it("says when it is the Cloudflare sandbox", async () => {
    env.offers = [offer("jumbos.com")];
    env.sandbox = true;
    const { card: c } = await card("domain.buy", { domain: "jumbos.com", stock: true });
    expect(c.warnings?.[0]).toMatch(/Test mode/);
    expect(c.fields?.find((f) => f.label === "For")?.value).toBe("No lead (a stock domain)");
  });
});

describe("domain.health", () => {
  it("runs the check through the health route and reports it", async () => {
    routes.replies["POST health"] = () =>
      Response.json({ health: { state: "up", summary: "Up — answered in 120 ms", http_status: 200, ms: 120, ssl: { valid: true, valid_to: "2027-01-01T00:00:00.000Z" } } });
    const res = await execute("domain.health", { domain: D1 });
    expect(callsTo("health")[0].params).toEqual({ id: D1 });
    expect(res.message).toBe("jumbospizza.com: Site up — Up — answered in 120 ms. SSL certificate valid until 2027-01-01.");
  });
});

describe("domain.autorenew", () => {
  it("flips auto-renew through the domain route, and undo flips it back", async () => {
    const { card: c, values } = await card("domain.autorenew", { domain: D1, on: "off" });
    expect(c.changes).toEqual([{ label: "Auto-renew", from: "On", to: "Off" }]);
    expect(c.warnings?.[0]).toMatch(/expires on 2027-10-01 unless someone renews it by hand/);
    await def("domain.autorenew").execute(values, ctxWith(), { actionId: "a", origin: "o" });
    expect(callsTo("domain")[0]).toMatchObject({ method: "PATCH", params: { id: D1 }, body: { autoRenew: false } });
    await def("domain.autorenew").undo!.run(stored({ domain: D1, on: false }, { id: D1 }, c.before), ctxWith());
    expect(callsTo("domain")[1].body).toEqual({ autoRenew: true });
  });

  it("refuses what the route refuses", async () => {
    expect((await prepare("domain.autorenew", { domain: D1, on: true })).problems[0].message).toBe("Auto-renew is already on for jumbospizza.com.");
    tables.client_domains[1].hostinger_subscription_id = null;
    expect((await prepare("domain.autorenew", { domain: D2, on: true })).problems[0].message).toMatch(/subscription isn't known yet/);
  });
});

describe("domain.dns", () => {
  it("names records the way the registrar lists them", () => {
    expect(relativeName("www.jumbospizza.com", "jumbospizza.com")).toBe("www");
    expect(relativeName("jumbospizza.com.", "jumbospizza.com")).toBe("@");
    expect(relativeName("", "jumbospizza.com")).toBe("@");
    expect(relativeName("MAIL", "jumbospizza.com")).toBe("mail");
  });

  it("changes the one record meant, keeping its TTL and proxy setting", async () => {
    const { card: c, values } = await card("domain.dns", { domain: D1, operation: "Change record", type: "A", content: "5.6.7.8" });
    expect(values.__original).toMatchObject({ id: "r1" });
    expect(values.__next).toEqual({ type: "A", name: "@", content: "5.6.7.8", ttl: 1, priority: null, proxied: false });
    expect(c.title).toBe("Change the A record @ on jumbospizza.com");
    expect(c.changes).toEqual([{ label: "A @", from: "1.2.3.4 (TTL auto)", to: "5.6.7.8 (TTL auto)" }]);
    expect(c.warnings?.[0]).toMatch(/carries jumbospizza\.com's website/);
    expect(c.confirmPhrase).toBe("jumbospizza.com");
    await def("domain.dns").execute(values, ctxWith(), { actionId: "a", origin: "o" });
    const call = callsTo("dns")[0];
    expect(call.params).toEqual({ id: D1 });
    expect(call.body).toEqual({ original: DNS[0], next: values.__next });
    expect(def("domain.dns").undo).toBeUndefined();
  });

  it("asks which record when several share the type and host", async () => {
    const p = await prepare("domain.dns", { domain: D1, operation: "Change record", type: "TXT", content: "v=spf1 include:x -all" });
    expect(p.problems).toEqual([
      {
        field: "_",
        message: "jumbospizza.com has 2 TXT records at @ — which one? Say its current value.",
        choices: ["TXT @ → v=spf1 -all", "TXT @ → google-site-verification=abc"],
      },
    ]);
    const picked = await prepare("domain.dns", { domain: D1, operation: "Change record", type: "TXT", old_content: "v=spf1 -all", content: "v=spf1 include:x -all" });
    expect(picked.problems).toEqual([]);
    expect(picked.values.__original).toMatchObject({ id: "r2" });
  });

  it("validates the new record with the route's own rules", async () => {
    const bad = await prepare("domain.dns", { domain: D1, operation: "Change record", type: "A", content: "example.com" });
    expect(bad.problems).toEqual([{ field: "content", message: "An A record points at an IPv4 address, e.g. 76.13.203.71" }]);
    const alias = await prepare("domain.dns", { domain: D1, operation: "Add record", type: "ALIAS", content: "example.com" });
    expect(alias.problems[0]).toMatchObject({ field: "type" });
    const dup = await prepare("domain.dns", { domain: D1, operation: "Add record", type: "CNAME", name: "www.jumbospizza.com", content: "jumbospizza.com." });
    expect(dup.problems).toEqual([{ field: "content", message: "jumbospizza.com already has that CNAME record at www." }]);
    const none = await prepare("domain.dns", { domain: D1, operation: "Delete record", type: "MX" });
    expect(none.problems[0].message).toBe("jumbospizza.com has no MX record at @.");
  });

  it("adds a record with the DNS panel's defaults", async () => {
    const p = await prepare("domain.dns", { domain: D1, operation: "Add record", type: "MX", content: "mail.example.com" });
    expect(p.values.__next).toEqual({ type: "MX", name: "@", content: "mail.example.com", ttl: 1, priority: 10, proxied: null });
    await p.d.execute(p.values, ctxWith(), { actionId: "a", origin: "o" });
    expect(callsTo("dns")[0].body).toEqual({ original: null, next: p.values.__next });
  });

  it("deletes the record named by its value", async () => {
    const p = await prepare("domain.dns", { domain: D1, operation: "Delete record", type: "TXT", content: "v=spf1 -all" });
    expect(p.problems).toEqual([]);
    const res = await p.d.execute(p.values, ctxWith(), { actionId: "a", origin: "o" });
    expect(callsTo("dns")[0].body).toEqual({ original: DNS[1], next: null });
    expect(res.message).toBe("Deleted the DNS record TXT @ → v=spf1 -all on jumbospizza.com.");
  });

  it("refuses to change a record that moved at the registrar after the card", async () => {
    const p = await prepare("domain.dns", { domain: D1, operation: "Change record", type: "A", content: "5.6.7.8" });
    const moved = { ...DNS[0], raw: "9.9.9.9", content: "9.9.9.9" };
    await expect(p.d.stale!({ original: moved }, p.values, ctxWith())).resolves.toMatch(/changed at the registrar/);
    await expect(p.d.stale!({ original: DNS[0] }, p.values, ctxWith())).resolves.toBeNull();
  });

  it("forwarding and reset are Hostinger-only, like the routes", async () => {
    expect((await prepare("domain.dns", { domain: D1, operation: "Forward domain", redirect_url: "example.com" })).problems[0]).toMatchObject({ field: "operation" });
    expect((await prepare("domain.dns", { domain: D1, operation: "Reset to defaults" })).problems[0]).toMatchObject({ field: "operation" });

    env.forwarding = { redirectType: "302", redirectUrl: "https://old.example.com" };
    const { card: c, values } = await card("domain.dns", { domain: D2, operation: "Forward domain", redirect_url: "example.com" });
    expect(c.changes).toEqual([{ label: "Forwarding", from: "302 → https://old.example.com", to: "301 → https://example.com/" }]);
    await def("domain.dns").execute(values, ctxWith(), { actionId: "a", origin: "o" });
    expect(callsTo("forwarding")[0]).toMatchObject({ method: "PUT", params: { id: D2 }, body: { redirectType: "301", redirectUrl: "https://example.com/" } });

    const stop = await prepare("domain.dns", { domain: D2, operation: "Stop forwarding" });
    await stop.d.execute(stop.values, ctxWith(), { actionId: "a", origin: "o" });
    expect(callsTo("forwarding")[1]).toMatchObject({ method: "DELETE", params: { id: D2 } });

    const reset = await prepare("domain.dns", { domain: D2, operation: "Reset to defaults" });
    await reset.d.execute(reset.values, ctxWith(), { actionId: "a", origin: "o" });
    expect(callsTo("reset")[0].params).toEqual({ id: D2 });
  });
});

describe("site.link", () => {
  it("links a domain through the domain route; undo unlinks it", async () => {
    const { card: c, values } = await card("site.link", { lead: LEAD, domain: D1 });
    expect(c.title).toBe("Link jumbospizza.com to Jumbo's Pizza");
    expect(c.notes?.[0]).toMatch(/starts the automatic setup/);
    const res = await def("site.link").execute(values, ctxWith(), { actionId: "a", origin: "o" });
    expect(callsTo("domain")[0]).toMatchObject({ method: "PATCH", params: { id: D1 }, body: { leadId: LEAD } });
    expect(res.data).toEqual({ what: "Domain", id: D1, previous: null });
    await def("site.link").undo!.run(stored(values, res.data!), ctxWith());
    expect(callsTo("domain")[1].body).toEqual({ leadId: null });
  });

  it("moving a domain from one lead to another warns, and undo gives it back", async () => {
    const { card: c, values } = await card("site.link", { lead: LEAD, domain: D2 });
    expect(c.warnings).toEqual(["It is linked to Ali's Grill now — that lead loses it."]);
    const res = await def("site.link").execute(values, ctxWith(), { actionId: "a", origin: "o" });
    await def("site.link").undo!.run(stored(values, res.data!), ctxWith());
    expect(callsTo("domain")[1].body).toEqual({ leadId: LEAD2 });
  });

  it("refuses what assignDomain refuses", async () => {
    expect((await prepare("site.link", { lead: LEAD2, domain: D1 })).problems).toEqual([
      { field: "lead", message: "This lead already has the domain alisgrill.com — unlink it first." },
    ]);
    expect((await prepare("site.link", { lead: LEAD2, domain: D2 })).problems[0].message).toBe("alisgrill.com is already linked to this lead.");
    tables.client_domains[0].status = "purchasing";
    expect((await prepare("site.link", { lead: LEAD, domain: D1 })).problems[0].message).toMatch(/Wait for the purchase/);
  });

  it("links a website through the deployments link route, without undo", async () => {
    const { card: c, values } = await card("site.link", { lead: LEAD2, site: S1 });
    expect(c.changes).toEqual([
      { label: "Website link", from: "https://alisgrill.com", to: "https://jumbos-pizza.dmviral.com" },
      { label: "Site's lead", from: "Jumbo's Pizza", to: "Ali's Grill" },
    ]);
    expect(c.warnings).toEqual(["Ali's Grill's current site (https://alisgrill.com) is marked as taken down on the board — its files stay on the hosting."]);
    routes.replies["POST link"] = () => Response.json({ ok: true, deploymentId: S1, url: "https://jumbos-pizza.dmviral.com" });
    const res = await def("site.link").execute(values, ctxWith(), { actionId: "a", origin: "o" });
    expect(callsTo("link")[0].body).toEqual({ leadId: LEAD2, deploymentId: S1 });
    expect(res.undoable).toBe(false);
    expect((await prepare("site.link", { lead: LEAD, site: S2 })).problems[0].message).toBe("Only a live site can be linked to a lead.");
  });
});

describe("site.restore", () => {
  const SNAPS = [snap("2026-10-13T12:00:00.000Z"), snap("2026-10-10T08:00:00.000Z")];

  it("restores the most recent saved version by default, through the restore route; undo puts the pre-restore copy back", async () => {
    env.snapshots = SNAPS;
    const { card: c, values } = await card("site.restore", { site: S1 });
    expect(values.__snapshot).toBe(SNAPS[0].path);
    expect(c.title).toBe("Restore jumbos-pizza.dmviral.com to its files from Tue, Oct 13, 5:00 PM");
    let preRestore = "";
    routes.replies["POST restore"] = () => {
      // The route saves the current files first: a new snapshot appears in the history.
      const fresh = snap(new Date().toISOString());
      preRestore = fresh.path;
      env.snapshots = [fresh, ...SNAPS];
      return Response.json({ ok: true, url: "https://jumbos-pizza.dmviral.com", files: 12, undoable: true });
    };
    const res = await def("site.restore").execute(values, ctxWith(), { actionId: "a", origin: "o" });
    const call = callsTo("restore")[0];
    expect(new URL(call.url).searchParams.get("site")).toBe("https://jumbos-pizza.dmviral.com");
    expect(call.body).toEqual({ path: SNAPS[0].path });
    const savedFirst = preRestore;
    expect(res.data).toEqual({ site: "https://jumbos-pizza.dmviral.com", restored: SNAPS[0].path, undo: savedFirst });
    expect(res.undoable).toBe(true);
    await def("site.restore").undo!.run(stored(values, res.data!), ctxWith());
    expect(callsTo("restore")[1].body).toEqual({ path: savedFirst });
  });

  it("picks the version saved at or before the time asked for (company time)", async () => {
    env.snapshots = SNAPS;
    // 12 Oct 10:00 in Karachi is 05:00 UTC: the 10 Oct version.
    expect((await prepare("site.restore", { site: S1, when: "2026-10-12T10:00" })).values.__snapshot).toBe(SNAPS[1].path);
    const early = await prepare("site.restore", { site: S1, when: "2026-10-01T10:00" });
    expect(early.problems[0]).toMatchObject({ field: "when", message: expect.stringMatching(/the oldest is from Sat, Oct 10, 1:00 PM/) });
  });

  it("refuses sites with nothing to restore", async () => {
    env.snapshots = [];
    expect((await prepare("site.restore", { site: S1 })).problems[0].message).toMatch(/no saved versions yet/);
    expect((await prepare("site.restore", { site: S2 })).problems[0].message).toMatch(/Only a live site's files can be restored/);
  });

  it("a newer saved version since the card makes it stale", async () => {
    env.snapshots = SNAPS;
    const p = await prepare("site.restore", { site: S1 });
    await expect(p.d.stale!({ snapshot: "snapshots/jumbos-pizza.dmviral.com/older.zip" }, p.values, ctxWith())).resolves.toMatch(/newer version/);
  });

  it("reads a snapshot's time from its name when storage gives none", () => {
    expect(snapshotTime({ name: "2026-10-14T18-00-00-000Z.zip", takenAt: null })).toBe(Date.parse("2026-10-14T18:00:00.000Z"));
  });
});

describe("site.transfer", () => {
  it("uses the lead's own domain by default and moves the site through the transfer route", async () => {
    tables.client_domains.push({ id: "d3", domain: "jumbospizza.net", lead_id: LEAD, status: "waiting_for_site" });
    const p = await prepare("site.transfer", { site: S1 });
    expect(p.problems).toEqual([]);
    expect(p.values).toMatchObject({ domain: "jumbospizza.net", __target: "jumbospizza.net" });
    expect(p.warnings[0]).toBe("Using jumbospizza.net, the domain linked to Jumbo's Pizza.");
    const c = await p.d.preview!(p.values, ctxWith());
    expect(c.confirmPhrase).toBe("jumbospizza.net");
    routes.replies["POST transfer"] = () =>
      Response.json({ url: "https://jumbospizza.net", provisioning: false, subdomainDeleted: true, settled: true, hostingCreated: true, snapshot: null, snapshotError: null, ssl: "installing" });
    const res = await p.d.execute(p.values, ctxWith(), { actionId: "a", origin: "o" });
    expect(callsTo("transfer")[0]).toMatchObject({ params: { id: S1 }, body: { domain: "jumbospizza.net" } });
    expect(res.message).toBe("Moved jumbos-pizza.dmviral.com to jumbospizza.net. https://jumbospizza.net is live. The staging address was removed. An SSL certificate was requested.");
  });

  it("refuses what the transfer refuses", async () => {
    expect((await prepare("site.transfer", { site: S1 })).problems).toEqual([{ field: "domain", message: "Which domain should jumbos-pizza.dmviral.com move to? Its lead has no domain linked." }]);
    expect((await prepare("site.transfer", { site: S1, domain: "new.dmviral.com" })).problems[0].message).toMatch(/staging address/);
    expect((await prepare("site.transfer", { site: S2, domain: "x.com" })).problems[0].message).toBe("Only a live site can be transferred.");
    expect((await prepare("site.transfer", { site: S4, domain: "x.com" })).problems[0].message).toMatch(/already transferred/);
    env.hg = false;
    expect((await prepare("site.transfer", { site: S1, domain: "x.com" })).problems).toContainEqual({ field: "_", message: "Hostinger is not configured." });
  });
});

describe("site.takedown", () => {
  it("takes the site down through the deployments route, with the address as the phrase", async () => {
    const { card: c, values } = await card("site.takedown", { site: S1 });
    expect(c.title).toBe("Take down jumbos-pizza.dmviral.com (Jumbo's Pizza)");
    expect(c.confirmPhrase).toBe("jumbos-pizza.dmviral.com");
    expect(c.warnings?.[0]).toMatch(/subdomain is deleted with all its files/);
    routes.replies["DELETE takedown"] = () => Response.json({ ok: true });
    await def("site.takedown").execute(values, ctxWith(), { actionId: "a", origin: "o" });
    expect(callsTo("takedown")[0]).toMatchObject({ method: "DELETE", params: { id: S1 } });
    expect(def("site.takedown").risk).toBe("critical");
    expect(def("site.takedown").undo).toBeUndefined();
  });

  it("refuses what the route refuses", async () => {
    expect((await prepare("site.takedown", { site: S2 })).problems[0].message).toBe("This site is already taken down.");
    expect((await prepare("site.takedown", { site: S3 })).problems[0].message).toBe("sedlms.com is a protected company domain — it cannot be taken down from the board.");
    env.hg = false;
    expect((await prepare("site.takedown", { site: S4 })).problems[0].message).toMatch(/Hostinger is not configured/);
  });
});

describe("helpers", () => {
  it("formats cents", () => {
    expect(cents(1046)).toBe("$10.46");
    expect(cents(null)).toBe("—");
    expect(cents(500, "EUR")).toBe("5.00 EUR");
  });
});

describe("domain.check phrases", () => {
  it("sends a phrase as it is", async () => {
    routes.replies["GET search"] = () => Response.json({ results: [] });
    const res = await execute("domain.check", { query: "jumbos pizza austin", registrar: "Hostinger" });
    expect(new URL(callsTo("search")[0].url).searchParams.get("q")).toBe("jumbos pizza austin");
    expect(new URL(callsTo("search")[0].url).searchParams.get("registrar")).toBe("hostinger");
    expect(res.message).toBe('Nothing available for "jumbos pizza austin" on Hostinger — try another name.');
  });
});

describe("plan steps", () => {
  it("a domain bought in an earlier step can be linked, checked and pointed — it is only looked up at confirm", async () => {
    const link = await prepare("site.link", { lead: LEAD, domain: "@1" }, ctxWith(), { stepRefs: true });
    expect(link.problems).toEqual([]);
    expect(link.values.what).toBe("Domain");
    const c = await link.d.preview!(link.values, ctxWith());
    expect(c.title).toBe("Link the domain from an earlier step to Jumbo's Pizza");
    for (const [key, raw] of [
      ["domain.health", { domain: "@1" }],
      ["domain.autorenew", { domain: "@1", on: false }],
      ["domain.dns", { domain: "@1", operation: "Add record", type: "A", content: "1.2.3.4" }],
    ] as const) {
      expect((await prepare(key, raw, ctxWith(), { stepRefs: true })).problems).toEqual([]);
    }
    const buy = await prepare("domain.buy", { domain: "jumbos.com", lead: "@2" }, ctxWith(), { stepRefs: true });
    expect(buy.problems.filter((p) => p.field === "lead")).toEqual([]);
  });
});
