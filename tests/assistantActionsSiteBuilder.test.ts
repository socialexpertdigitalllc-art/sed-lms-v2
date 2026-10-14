// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GENERATE_WAIT_MS, matchPage, SITE_BUILDER_ACTIONS, settleWithin } from "@/lib/assistant/actions/defs/sitebuilder";
import { missingFields, normalizeFields } from "@/lib/assistant/actions/fields";
import { RouteError } from "@/lib/assistant/actions/invoke";
import type { ActionContext, ActionDef, StoredAction, Values } from "@/lib/assistant/actions/types";

/**
 * Site Builder actions over a fake database, with every route they call
 * mocked: what matters is that each action refuses exactly what its route
 * refuses, asks for exactly what the route needs, and sends the route the
 * same request the Site Builder screens send.
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

vi.mock("@/app/api/site-builder/runs/route", () => ({ POST: routes.handler("runs", "POST") }));
vi.mock("@/app/api/site-builder/runs/[id]/route", () => ({ DELETE: routes.handler("run", "DELETE") }));
vi.mock("@/app/api/site-builder/runs/bulk/route", () => ({ POST: routes.handler("bulk", "POST") }));
vi.mock("@/app/api/site-builder/runs/[id]/generate/route", () => ({ POST: routes.handler("generate", "POST") }));
vi.mock("@/app/api/site-builder/runs/[id]/pages/[file]/regenerate/route", () => ({ POST: routes.handler("regenerate", "POST") }));
vi.mock("@/app/api/site-builder/runs/[id]/approve/route", () => ({ POST: routes.handler("approve", "POST") }));
vi.mock("@/app/api/site-builder/runs/[id]/deploy/route", () => ({ POST: routes.handler("deploy", "POST") }));
vi.mock("@/app/api/site-builder/images/source/route", () => ({ POST: routes.handler("source", "POST") }));
vi.mock("@/app/api/site-builder/images/pick/route", () => ({ POST: routes.handler("pick", "POST") }));

const env = vi.hoisted(() => ({ da: true }));
vi.mock("@/lib/template-engine/directadmin", async (orig) => ({ ...(await orig<object>()), daConfigured: () => env.da }));

/* -------------------------------------------------------------- fake db */

type Row = Record<string, unknown>;

/** A chainable stand-in for supabase-js over fixture rows (select / insert / update / delete). */
function fakeDb(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let op: "select" | "insert" | "update" | "delete" = "select";
      let payload: unknown = null;
      let single = false;
      let limit: number | null = null;
      let order: { col: string; asc: boolean } | null = null;
      const b: Record<string, unknown> = {};
      const where = (f: (r: Row) => boolean) => (filters.push(f), b);
      Object.assign(b, {
        select: () => b,
        insert: (p: unknown) => ((op = "insert"), (payload = p), b),
        update: (p: unknown) => ((op = "update"), (payload = p), b),
        delete: () => ((op = "delete"), b),
        eq: (c: string, v: unknown) => where((r) => r[c] === v),
        neq: (c: string, v: unknown) => where((r) => r[c] !== v),
        is: (c: string, v: unknown) => where((r) => (r[c] ?? null) === v),
        in: (c: string, vs: unknown[]) => where((r) => vs.includes(r[c])),
        ilike: (c: string, p: string) => where((r) => String(r[c] ?? "").toLowerCase().includes(p.replace(/%/g, "").toLowerCase())),
        or: () => b,
        order: (col: string, o?: { ascending?: boolean }) => ((order = { col, asc: o?.ascending !== false }), b),
        limit: (n: number) => ((limit = n), b),
        maybeSingle: () => ((single = true), b),
        single: () => ((single = true), b),
        then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
          const rows = (tables[table] ??= []);
          let hit = rows.filter((r) => filters.every((f) => f(r)));
          if (op === "insert") {
            const items = (Array.isArray(payload) ? payload : [payload]) as Row[];
            rows.push(...items);
            hit = items;
          } else if (op === "update") hit.forEach((r) => Object.assign(r, payload));
          else if (op === "delete") tables[table] = rows.filter((r) => !hit.includes(r));
          if (order) {
            const { col, asc } = order;
            hit = [...hit].sort((a, z) => (String(a[col]) < String(z[col]) ? -1 : 1) * (asc ? 1 : -1));
          }
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
const T1 = "20000000-0000-4000-8000-000000000001";
const RUN_REVIEW = "30000000-0000-4000-8000-000000000001";
const RUN_FAILED = "30000000-0000-4000-8000-000000000002";
const RUN_QUEUED = "30000000-0000-4000-8000-000000000003";
const RUN_DEPLOYED = "30000000-0000-4000-8000-000000000004";
const RUN_APPROVED = "30000000-0000-4000-8000-000000000005";
const NOW = new Date("2026-10-14T10:00:00Z");
const JUMBO = { business_name: "Jumbo's Pizza" };

const PAGES = {
  "index.html": { status: "ok", kind: "existing" },
  "about.html": { status: "ok", kind: "existing" },
  "contact-us.html": { status: "ok", kind: "new", name: "Contact Us" },
  "services-plumbing.html": { status: "ok", kind: "new", name: "Plumbing" },
  "services-roofing.html": { status: "failed", kind: "new", name: "Roofing" },
  "components.js": { status: "ok", kind: "component", name: "Shared components" },
};

let tables: Record<string, Row[]>;

function fixtures(): Record<string, Row[]> {
  const run = (id: string, status: string, over: Row = {}): Row => ({
    id,
    status,
    lead_id: LEAD,
    template_id: T1,
    output_path: `${id}/site.zip`,
    deployed_url: null,
    updated_at: "2026-10-14T09:58:00Z",
    created_at: "2026-10-14T09:00:00Z",
    generation_id: null,
    pages: PAGES,
    leads: JUMBO,
    ...over,
  });
  return {
    leads: [
      {
        id: LEAD,
        business_name: "Jumbo's Pizza",
        status: "Not Ready",
        agent_id: USER,
        deleted_at: null,
        website_link: null,
        recommended_template_id: T1,
        image_links: ["https://img.example.com/a.jpg", "https://img.example.com/b.jpg"],
        updated_at: "2026-10-14T08:00:00Z",
      },
      {
        id: LEAD2,
        business_name: "Ali's Grill",
        status: "Ready",
        agent_id: USER,
        deleted_at: null,
        website_link: "https://alis-grill.dmviral.com",
        recommended_template_id: null,
        image_links: [],
        updated_at: "2026-10-14T08:00:00Z",
      },
    ],
    builder_templates: [{ id: T1, name: "Bistro" }],
    builder_runs: [
      run(RUN_REVIEW, "review"),
      run(RUN_FAILED, "failed", { output_path: null }),
      run(RUN_QUEUED, "queued", { output_path: null, pages: {} }),
      run(RUN_DEPLOYED, "deployed", { lead_id: LEAD2, deployed_url: "https://alis-grill.dmviral.com", leads: { business_name: "Ali's Grill" }, created_at: "2026-10-01T09:00:00Z" }),
      run(RUN_APPROVED, "approved"),
    ],
    studio_deployments: [],
    profiles: [],
    activity_log: [],
  };
}

function ctxWith(perms: string[] = ["studio.manage"]): ActionContext {
  const db = fakeDb(tables);
  return { userId: USER, displayName: "Sam", perms: new Set(perms), db, admin: db, timezone: "Asia/Karachi", now: NOW, isAdmin: false };
}

const def = (key: string): ActionDef => {
  const d = SITE_BUILDER_ACTIONS.find((a) => a.key === key);
  if (!d) throw new Error(`no ${key}`);
  return d;
};

/** What the framework does before a card: normalise, then the check, its values merged in. */
async function prepare(key: string, raw: Values, ctx = ctxWith(), opts: { stepRefs?: boolean } = {}) {
  const d = def(key);
  const n = await normalizeFields(d, raw, ctx, opts);
  const checked = d.check ? ((await d.check(n.values, ctx)) ?? {}) : {};
  const values = { ...n.values, ...(checked.values ?? {}) };
  return { d, n, values, missing: missingFields(d, n.values, n.problems).map((f) => f.name), problems: [...n.problems, ...(checked.problems ?? [])], warnings: checked.warnings ?? [] };
}

async function execute(key: string, raw: Values, ctx = ctxWith()) {
  const p = await prepare(key, raw, ctx);
  expect(p.problems).toEqual([]);
  return p.d.execute(p.values, ctx, { actionId: "act-1", origin: "https://dash.example.com" });
}

const callsTo = (route: string) => routes.calls.filter((c) => c.route === route);

beforeEach(() => {
  tables = fixtures();
  routes.calls.length = 0;
  for (const k of Object.keys(routes.replies)) delete routes.replies[k];
  env.da = true;
  process.env.DA_DOMAIN = "dmviral.com";
});

afterEach(() => {
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ tests */

describe("who may", () => {
  it("every Site Builder action needs studio.manage, like guard() on every route", () => {
    for (const d of SITE_BUILDER_ACTIONS) {
      expect(d.allowed(ctxWith([]))).toBe("Your account doesn't have “Manage Site Studio (Template Engine v3)”.");
      expect(d.allowed(ctxWith(["leads.create"]))).not.toBeNull();
      expect(d.allowed(ctxWith(["studio.manage"]))).toBeNull();
    }
  });
});

describe("required fields", () => {
  it("build.start needs only the lead; images and auto-deploy default to the New Site screen's", async () => {
    expect((await prepare("build.start", {})).missing).toEqual(["lead"]);
    const p = await prepare("build.start", { lead: LEAD });
    expect(p.missing).toEqual([]);
    expect(p.values.images).toBe("Automatic");
    expect(p.values.auto_deploy).toBe(true);
  });

  it("build.start is critical when it publishes itself, standard when it waits for review", async () => {
    const risk = def("build.start").risk as (v: Values) => string;
    expect(risk((await prepare("build.start", { lead: LEAD })).values)).toBe("critical");
    expect(risk((await prepare("build.start", { lead: LEAD, auto_deploy: "no" })).values)).toBe("standard");
  });

  it("build.bulk needs a template for the batch (the route has no fallback)", async () => {
    expect((await prepare("build.bulk", { leads: [LEAD] })).missing).toEqual(["template"]);
    expect((await prepare("build.bulk", { leads: [LEAD], template: T1 })).missing).toEqual([]);
  });

  it("the run is required for regen, deploy and delete; an instruction only applies to a page", async () => {
    for (const key of ["build.regen", "build.deploy", "build.delete"]) expect((await prepare(key, {})).missing).toEqual(["run"]);
    const p = await prepare("build.regen", { run: RUN_FAILED, instruction: "warmer" });
    expect(p.values.instruction).toBeUndefined();
  });

  it("a bulk batch is capped at the route's 50 leads", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `40000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    tables.leads.push(...ids.map((id) => ({ id, business_name: id, status: "Not Ready", deleted_at: null })));
    const p = await prepare("build.bulk", { leads: ids, template: T1 });
    expect(p.problems[0]?.message).toMatch(/at most 50/);
  });
});

describe("build.start", () => {
  it("falls back to the lead's recommended template, and says when there is none", async () => {
    const ok = await prepare("build.start", { lead: LEAD });
    expect(ok.problems).toEqual([]);
    expect(ok.values.__template).toBe("Bistro (picked by sales with the client)");

    const none = await prepare("build.start", { lead: LEAD2 });
    expect(none.problems).toEqual([{ field: "template", message: "Ali's Grill has no recommended template — which template should the site use?" }]);
    expect(none.warnings.join(" ")).toMatch(/Ali's Grill is Ready — the New Site screen only builds sites for Not Ready leads/);
    expect(none.warnings.join(" ")).toMatch(/current site \(https:\/\/alis-grill\.dmviral\.com\) is replaced/);
  });

  it("warns when the lead already has a build queued", async () => {
    const p = await prepare("build.start", { lead: LEAD });
    expect(p.warnings).toContain("Jumbo's Pizza already has a build queued — this starts a second one.");
  });

  it("with the template's own images: creates the run with no images and the route's template fallback", async () => {
    routes.replies["POST runs"] = () => Response.json({ run: { id: "run-new" } }, { status: 201 });
    const res = await execute("build.start", { lead: LEAD, images: "Template's own" });
    expect(callsTo("runs")).toHaveLength(1);
    expect(callsTo("runs")[0].body).toEqual({ lead_id: LEAD, images: [], options: { auto_deploy: true } });
    expect(callsTo("source")).toHaveLength(0);
    expect(res.data).toEqual({ id: "run-new", kind: "site_run" });
    expect(res.link?.href).toBe("/ai-tools/site-builder/runs/run-new");
    expect(res.message).toMatch(/with Bistro/);
    expect(def("build.start").produces).toBe("site_run");
  });

  it("automatic images: the screen's default picks — top 3 hero, first per service, client photos as gallery", async () => {
    routes.replies["POST source"] = () =>
      Response.json({
        hero: [
          { kind: "library", key: "l1", url: "https://lib.example.com/1.jpg", thumb_url: "t" },
          { kind: "pexels", key: "p1", download_url: "https://images.pexels.com/2.jpg", thumb_url: "t2", pexels_id: 2, width: 10, height: 5, photographer: "Ann" },
          { kind: "client", key: "c1", url: "https://img.example.com/a.jpg", thumb_url: "https://img.example.com/a.jpg" },
          { kind: "library", key: "l4", url: "https://lib.example.com/4.jpg", thumb_url: "t" },
        ],
        services: [
          { service: "Pizza", purpose: "Service: Pizza", query: "pizza", pexelsError: null, candidates: [{ kind: "pexels", key: "p9", download_url: "https://images.pexels.com/9.jpg", thumb_url: "t9" }] },
          { service: "Catering", purpose: "Service: Catering", query: "catering", pexelsError: null, candidates: [] },
        ],
      });
    routes.replies["POST pick"] = (call) => {
      const b = call.body as { url?: string; pexels?: { download_url?: string } };
      return Response.json({ url: b.url ?? b.pexels?.download_url });
    };
    routes.replies["POST runs"] = () => Response.json({ run: { id: "run-new" } }, { status: 201 });

    await execute("build.start", { lead: LEAD, template: T1, instructions: "  English and Spanish  ", auto_deploy: false });

    expect(callsTo("source")[0].body).toEqual({ lead_id: LEAD });
    const picks = callsTo("pick").map((c) => c.body);
    expect(picks).toContainEqual({ kind: "link", url: "https://lib.example.com/1.jpg", subject: "Hero" });
    expect(picks).toContainEqual({
      kind: "pexels",
      pexels: { download_url: "https://images.pexels.com/2.jpg", thumb_url: "t2", pexels_id: 2, width: 10, height: 5, photographer: "Ann", subject: "Hero" },
    });
    expect(picks).toContainEqual({ kind: "client", url: "https://img.example.com/a.jpg", lead_id: LEAD, subject: "Hero" });
    expect(picks).toContainEqual({ kind: "client", url: "https://img.example.com/b.jpg", lead_id: LEAD });
    expect(picks).not.toContainEqual(expect.objectContaining({ url: "https://lib.example.com/4.jpg" }));

    expect(callsTo("runs")[0].body).toEqual({
      lead_id: LEAD,
      template_id: T1,
      images: [
        { url: "https://lib.example.com/1.jpg", purpose: "Hero" },
        { url: "https://images.pexels.com/2.jpg", purpose: "Hero" },
        { url: "https://img.example.com/a.jpg", purpose: "Hero" },
        { url: "https://images.pexels.com/9.jpg", purpose: "Service: Pizza" },
        { url: "https://img.example.com/a.jpg", purpose: "Gallery" },
        { url: "https://img.example.com/b.jpg", purpose: "Gallery" },
      ],
      options: { auto_deploy: false, instructions: "English and Spanish" },
    });
  });

  it("the person's own hero images replace the automatic hero picks", async () => {
    routes.replies["POST source"] = () => Response.json({ hero: [{ kind: "library", key: "l1", url: "https://lib.example.com/1.jpg" }], services: [] });
    routes.replies["POST pick"] = (call) => Response.json({ url: (call.body as { url: string }).url });
    routes.replies["POST runs"] = () => Response.json({ run: { id: "run-new" } }, { status: 201 });
    await execute("build.start", { lead: LEAD, hero_images: ["https://photos.example.com/hero.jpg"] });
    const body = callsTo("runs")[0].body as { images: { url: string; purpose: string }[] };
    expect(body.images.filter((i) => i.purpose === "Hero")).toEqual([{ url: "https://photos.example.com/hero.jpg", purpose: "Hero" }]);
    expect(callsTo("pick")[0].body).toEqual({ kind: "link", url: "https://photos.example.com/hero.jpg", subject: "Hero" });
  });

  it("a sourcing failure does not stop the build (as on the screen); it is said in the result", async () => {
    routes.replies["POST source"] = () => Response.json({ error: "Pexels is down" }, { status: 502 });
    routes.replies["POST pick"] = (call) => Response.json({ url: (call.body as { url: string }).url });
    routes.replies["POST runs"] = () => Response.json({ run: { id: "run-new" } }, { status: 201 });
    const res = await execute("build.start", { lead: LEAD });
    expect((callsTo("runs")[0].body as { images: unknown[] }).images).toHaveLength(2);
    expect(res.message).toMatch(/stock photos could not be found \(Pexels is down\)/);
  });

  it("the route's refusal is the action's failure", async () => {
    routes.replies["POST runs"] = () => Response.json({ error: "Template not found" }, { status: 404 });
    await expect(execute("build.start", { lead: LEAD, images: "Template's own" })).rejects.toThrow("Template not found");
  });

  it("undo cancels the build only while it is still queued", async () => {
    const stored = { result: { message: "", data: { id: RUN_QUEUED } }, input: {} } as unknown as StoredAction;
    await expect(def("build.start").undo!.run(stored, ctxWith())).resolves.toMatch(/cancelled/);
    expect(tables.builder_runs.find((r) => r.id === RUN_QUEUED)).toBeUndefined();
    expect(tables.activity_log[0]).toMatchObject({ action: "site_builder.run.deleted", entity_id: RUN_QUEUED });

    const started = { result: { message: "", data: { id: RUN_REVIEW } }, input: {} } as unknown as StoredAction;
    await expect(def("build.start").undo!.run(started, ctxWith())).rejects.toThrow(/already started/);
    expect(tables.builder_runs.find((r) => r.id === RUN_REVIEW)).toBeDefined();
    await expect(def("build.start").undo!.run(stored, ctxWith([]))).rejects.toBeInstanceOf(RouteError);
  });
});

describe("build.regen", () => {
  it("finds the page the person names", () => {
    expect(matchPage("about page", PAGES)).toEqual({ file: "about.html" });
    expect(matchPage("Home", PAGES)).toEqual({ file: "index.html" });
    expect(matchPage("the homepage", PAGES)).toEqual({ file: "index.html" });
    expect(matchPage("contact us", PAGES)).toEqual({ file: "contact-us.html" });
    expect(matchPage("Roofing", PAGES)).toEqual({ file: "services-roofing.html" });
    expect(matchPage("ABOUT.HTML", PAGES)).toEqual({ file: "about.html" });
    const many = matchPage("services", PAGES);
    expect(many).toMatchObject({ choices: ["Plumbing (services-plumbing.html)", "Roofing (services-roofing.html)"] });
    const none = matchPage("blog", PAGES);
    expect("problem" in none && none.problem).toMatch(/no page called "blog"/);
    expect("problem" in none && none.problem).not.toMatch(/components\.js/);
  });

  it("rewrites one page through the page-regenerate route, with the instruction", async () => {
    routes.replies["POST regenerate"] = () => Response.json({ run: { id: RUN_REVIEW } });
    const res = await execute("build.regen", { run: RUN_REVIEW, page: "about page", instruction: "shorter hero" });
    const call = callsTo("regenerate")[0];
    expect(call.params).toEqual({ id: RUN_REVIEW, file: "about.html" });
    expect(call.url).toMatch(new RegExp(`/api/site-builder/runs/${RUN_REVIEW}/pages/about\\.html/regenerate$`));
    expect(call.body).toEqual({ instruction: "shorter hero" });
    expect(res.message).toBe("Regenerated about.html on Jumbo's Pizza's site.");
  });

  it("a page that fails to regenerate fails the action with the route's words", async () => {
    routes.replies["POST regenerate"] = () => Response.json({ run: {}, error: "Provider timed out" }, { status: 502 });
    await expect(execute("build.regen", { run: RUN_REVIEW, page: "about" })).rejects.toThrow("Provider timed out");
  });

  it("refuses what the routes refuse", async () => {
    const whole = await prepare("build.regen", { run: RUN_REVIEW });
    expect(whole.problems[0]).toMatchObject({ field: "_", message: expect.stringMatching(/waiting for review cannot be regenerated as a whole/) });
    const deployed = await prepare("build.regen", { run: RUN_DEPLOYED, page: "about" });
    expect(deployed.problems[0]).toMatchObject({ field: "page", message: expect.stringMatching(/deployed/) });
    const queuedPage = await prepare("build.regen", { run: RUN_QUEUED, page: "about" });
    expect(queuedPage.problems[0].message).toBe('Cannot regenerate: this run is "queued", not "review", "approved" or "failed".');
    tables.builder_runs[0].generation_id = "gen-1";
    const held = await prepare("build.regen", { run: RUN_REVIEW, page: "about" });
    expect(held.problems[0]).toMatchObject({ field: "run", message: expect.stringMatching(/Stop and recover/) });
    const unknown = await prepare("build.regen", { run: RUN_FAILED, page: "blog" });
    expect(unknown.problems[0]).toMatchObject({ field: "page" });
  });

  it("a failed run is retried through the generate route; a quick answer is reported", async () => {
    routes.replies["POST generate"] = () => Response.json({ run: { id: RUN_FAILED, status: "review" } });
    const res = await execute("build.regen", { run: RUN_FAILED });
    expect(callsTo("generate")[0].params).toEqual({ id: RUN_FAILED });
    expect(res.message).toBe("Jumbo's Pizza's run is waiting for review.");
  });

  it("a long retry is left running in the background, like the run screen's Retry", async () => {
    vi.useFakeTimers();
    routes.replies["POST generate"] = () => new Promise<Response>(() => {});
    const p = await prepare("build.regen", { run: RUN_FAILED });
    const pending = p.d.execute(p.values, ctxWith(), { actionId: "a", origin: "o" });
    await vi.advanceTimersByTimeAsync(GENERATE_WAIT_MS + 10);
    await expect(pending).resolves.toMatchObject({ message: "Retrying the failed pages of Jumbo's Pizza's build — it keeps running in the background." });
  });

  it("an immediate refusal from the generate route fails the action", async () => {
    routes.replies["POST generate"] = () => Response.json({ error: 'Cannot generate: this run is "review", not "queued" or "failed".' }, { status: 409 });
    await expect(execute("build.regen", { run: RUN_FAILED })).rejects.toThrow(/Cannot generate/);
  });

  it("settleWithin reports the outcome or that it is still going", async () => {
    await expect(settleWithin(Promise.resolve(1), 50)).resolves.toEqual({ state: "fulfilled", value: 1 });
    await expect(settleWithin(Promise.reject(new Error("x")), 50)).resolves.toMatchObject({ state: "rejected" });
    await expect(settleWithin(new Promise(() => {}), 5)).resolves.toEqual({ state: "pending" });
  });
});

describe("build.deploy", () => {
  it("approves a run in review, then deploys it", async () => {
    routes.replies["POST deploy"] = () => Response.json({ url: "https://jumbo-s-pizza.dmviral.com", sub: "jumbo-s-pizza", reused: false, clearWarning: null });
    const res = await execute("build.deploy", { run: RUN_REVIEW });
    expect(routes.calls.map((c) => c.route)).toEqual(["approve", "deploy"]);
    expect(callsTo("approve")[0].params).toEqual({ id: RUN_REVIEW });
    expect(res.message).toBe("Jumbo's Pizza's website is live at https://jumbo-s-pizza.dmviral.com.");
  });

  it("an approved run is only deployed", async () => {
    routes.replies["POST deploy"] = () => Response.json({ url: "https://jumbo-s-pizza.dmviral.com" });
    await execute("build.deploy", { run: RUN_APPROVED });
    expect(routes.calls.map((c) => c.route)).toEqual(["deploy"]);
  });

  it("refuses runs that cannot be published, and an unconfigured host", async () => {
    expect((await prepare("build.deploy", { run: RUN_QUEUED })).problems[0].message).toMatch(/still queued/);
    expect((await prepare("build.deploy", { run: RUN_DEPLOYED })).problems[0].message).toMatch(/already live at https:\/\/alis-grill/);
    expect((await prepare("build.deploy", { run: RUN_FAILED })).problems[0].message).toMatch(/failed/);
    env.da = false;
    expect((await prepare("build.deploy", { run: RUN_REVIEW })).problems).toContainEqual({ field: "_", message: expect.stringMatching(/not configured/) });
  });

  it("the card names where it lands and asks for the business name", async () => {
    const p = await prepare("build.deploy", { run: RUN_REVIEW });
    const card = await p.d.preview!(p.values, ctxWith());
    expect(card.title).toBe("Publish Jumbo's Pizza's website to jumbo-s-pizza.dmviral.com");
    expect(card.confirmPhrase).toBe("Jumbo's Pizza");
    expect(def("build.deploy").risk).toBe("critical");
  });
});

describe("build.bulk", () => {
  it("queues the batch through the bulk route", async () => {
    routes.replies["POST bulk"] = () =>
      Response.json(
        { results: [{ lead_id: LEAD, created: "run-a" }, { lead_id: LEAD2, skipped: "this lead already has a run queued or generating" }], created: 1, skipped: 1 },
        { status: 201 },
      );
    const res = await execute("build.bulk", { leads: [LEAD, LEAD2], template: T1 });
    expect(callsTo("bulk")[0].body).toEqual({ lead_ids: [LEAD, LEAD2], template_id: T1 });
    expect(res.message).toBe("Queued 1 website build; skipped 1 (this lead already has a run queued or generating).");
    expect(res.data).toEqual({ ids: ["run-a"] });
  });

  it("passes instructions for every run in the batch", async () => {
    routes.replies["POST bulk"] = () => Response.json({ results: [], created: 0, skipped: 0 }, { status: 201 });
    await execute("build.bulk", { leads: [LEAD], template: T1, instructions: "Formal tone" });
    expect(callsTo("bulk")[0].body).toEqual({ lead_ids: [LEAD], template_id: T1, options: { instructions: "Formal tone" } });
  });

  it("the card lists every lead, noting the ones that already have a run", async () => {
    const p = await prepare("build.bulk", { leads: [LEAD, LEAD2], template: T1 });
    const card = await p.d.preview!(p.values, ctxWith());
    expect(card.title).toBe("Queue 2 website builds with Bistro");
    expect(card.items).toEqual([
      { id: LEAD, label: "Jumbo's Pizza", detail: "Not Ready · already has a build queued or generating — it will be skipped", href: `/leads/${LEAD}`, selected: true },
      { id: LEAD2, label: "Ali's Grill", detail: "Ready · already has a published build", href: `/leads/${LEAD2}`, selected: true },
    ]);
    expect(card.warnings).toEqual(["1 lead already has a build queued or generating and will be skipped.", "1 lead is not Not Ready — the bulk picker only offers Not Ready leads."]);
    expect(def("build.bulk").bulkField).toBe("leads");
  });

  it("undo cancels the runs still queued and says which had started", async () => {
    const stored = { result: { message: "", data: { ids: [RUN_QUEUED, RUN_REVIEW] } }, input: {} } as unknown as StoredAction;
    await expect(def("build.bulk").undo!.run(stored, ctxWith())).resolves.toBe("1 build cancelled (1 had already started and keep going).");
  });
});

describe("build.delete", () => {
  it("refuses a run that is still active, like the route", async () => {
    const p = await prepare("build.delete", { run: RUN_QUEUED });
    expect(p.problems[0].message).toMatch(/still generating/);
    tables.builder_runs.find((r) => r.id === RUN_QUEUED)!.updated_at = "2026-10-14T07:00:00Z";
    expect((await prepare("build.delete", { run: RUN_QUEUED })).problems).toEqual([]);
  });

  it("deletes through the run route and warns that a deployed site stays up", async () => {
    const p = await prepare("build.delete", { run: RUN_DEPLOYED });
    const card = await p.d.preview!(p.values, ctxWith());
    expect(card.warnings?.join(" ")).toMatch(/stays live at https:\/\/alis-grill\.dmviral\.com/);
    expect(card.confirmPhrase).toBe("Ali's Grill");
    await p.d.execute(p.values, ctxWith(), { actionId: "a", origin: "o" });
    expect(callsTo("run")[0]).toMatchObject({ method: "DELETE", params: { id: RUN_DEPLOYED } });
  });

  it("refuses to proceed when the run moved on since the card", async () => {
    const p = await prepare("build.delete", { run: RUN_REVIEW });
    tables.builder_runs[0].status = "approved";
    await expect(p.d.stale!({ status: "review" }, p.values, ctxWith())).resolves.toMatch(/approved now/);
  });
});

describe("plan steps", () => {
  it("a lead created in an earlier step can be built for — it is only looked up at confirm", async () => {
    const p = await prepare("build.start", { lead: "@1" }, ctxWith(), { stepRefs: true });
    expect(p.problems).toEqual([]);
    const c = await p.d.preview!(p.values, ctxWith());
    expect(c.title).toBe("Build a website for the lead from an earlier step");
    expect(c.link).toBeNull();
  });

  it("a build started in an earlier step can be named by later steps", async () => {
    for (const key of ["build.regen", "build.deploy", "build.delete"]) {
      const p = await prepare(key, { run: "@1" }, ctxWith(), { stepRefs: true });
      expect(p.problems.filter((x) => x.field === "run")).toEqual([]);
    }
  });
});
