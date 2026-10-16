// tests/siteAgentRoutes.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SiteCopy } from "@/lib/site-agent/siteCopy";

const processMock = vi.hoisted(() => vi.fn());
const mmMock = vi.hoisted(() => ({
  resolve: vi.fn(async (raw: unknown) => ({ ok: true as const, model: typeof raw === "string" ? raw : "MiniMax-M3" })),
  run: vi.fn(async () => {}),
  afters: [] as (() => unknown)[],
}));
vi.mock("@/lib/site-agent/minimaxRunner", async (orig) => ({
  ...(await orig<object>()),
  resolveMinimaxChoice: mmMock.resolve,
  runClaimedMinimax: mmMock.run,
  minimaxAvailability: async () => ({ available: true, reason: null }),
}));
vi.mock("next/server", async (orig) => ({
  ...(await orig<object>()),
  after: (cb: () => unknown) => { mmMock.afters.push(cb); },
}));
vi.mock("@/lib/site-agent/worker", () => ({ processNextAgentRun: processMock }));
vi.mock("@/lib/site-agent/workspaceFs", () => ({ fsWorkspace: {} }));
vi.mock("@/lib/site-agent/agy", () => ({ runAgy: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminState.client }));
vi.mock("@/lib/notifications/notify", () => ({ notify: vi.fn() }));

// — appended by Task 7 —
const accessState = vi.hoisted(() => ({
  user: { id: "dev-1" } as { id: string } | null,
  perms: new Set<string>(["tickets.resolve"]),
  run: {
    id: "run-1", ticket_id: "t-1", lead_id: "lead-1", site_host: "acme.dmviral.com",
    status: "review", files: {}, created_by: "dev-1",
  } as Record<string, unknown> | null,
  ticket: { id: "t-1", created_by: "sales-1", lead_id: "lead-1", assigned_to: "dev-1" } as Record<string, unknown> | null,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: accessState.user } }) } }),
}));
vi.mock("@/lib/permissions/resolver", () => ({ getUserPermissions: async () => accessState.perms }));
vi.mock("@/lib/tickets/scope", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  allowedTicketScope: async () => ({ all: false, leadIds: new Set<string>() }),
}));

// — appended by Task 8 —
// Configurable fake admin client. The earlier describes never call methods on
// the admin object (process route mocks the worker; agentRunAccess tests pass
// their own accessAdmin()), so this richer fake stays compatible with them.
const adminState = vi.hoisted(() => {
  type Row = Record<string, unknown> | null;
  type Result = { data: unknown; error: { message: string } | null };
  type Chain = {
    select: (...a: unknown[]) => Chain;
    eq: (...a: unknown[]) => Chain;
    is: (...a: unknown[]) => Chain;
    in: (...a: unknown[]) => Chain;
    order: (...a: unknown[]) => Chain;
    limit: (...a: unknown[]) => Chain;
    insert: (values: Record<string, unknown>) => Chain;
    update: (values: Record<string, unknown>) => Chain;
    maybeSingle: () => Promise<Result>;
    single: () => Promise<Result>;
    then: <T>(resolve: (v: Result) => T) => T;
  };
  const state = {
    ticket: null as Row, // lead_tickets .maybeSingle()
    lead: null as Row, // leads .maybeSingle() (lead agent-runs route)
    run: null as Row, // site_agent_runs .eq().maybeSingle() (agentRunAccess path)
    activeRun: null as Row, // site_agent_runs ....in().maybeSingle() (active-run check)
    insertedRun: { id: "run-9" } as Row,
    insertError: null as { message: string; code?: string } | null,
    /** Per-call insert errors, consumed first (null = that call succeeds). */
    insertErrorQueue: [] as ({ message: string; code?: string } | null)[],
    /** lead_tickets .update().select().single() — the auto-start mirror */
    ticketUpdateError: null as { message: string } | null,
    runsList: [] as unknown[],
    itemsList: [] as unknown[], // ticket_items select (thenable)
    settings: null as Row, // app_settings .maybeSingle()
    uploadError: null as { message: string } | null,
    inserts: [] as { table: string; values: Record<string, unknown> }[],
    updates: [] as { table: string; values: Record<string, unknown>; filters?: [string, unknown][] }[],
    uploads: [] as { bucket: string; path: string }[],
    /** The bytes each upload() received, index-aligned with `uploads`. */
    uploadBodies: [] as unknown[],
    removes: [] as { bucket: string; paths: string[] }[],
    /** Interleaved op log — pins the upload-BEFORE-insert ordering. */
    ops: [] as string[],
    client: null as unknown,
    reset() {
      state.ticket = null; state.lead = null; state.run = null; state.activeRun = null;
      state.insertedRun = { id: "run-9" }; state.insertError = null; state.insertErrorQueue = []; state.ticketUpdateError = null;
      state.runsList = []; state.itemsList = []; state.settings = null; state.uploadError = null;
      state.inserts = []; state.updates = []; state.uploads = []; state.uploadBodies = [];
      state.removes = []; state.ops = [];
    },
  };
  function query(table: string): Chain {
    let usedIn = false;
    let usedUpdate = false;
    let updateValues: Record<string, unknown> | null = null;
    const eqFilters: [string, unknown][] = [];
    const q: Chain = {
      select: () => q,
      eq: (...a) => { eqFilters.push([a[0] as string, a[1]]); return q; },
      is: () => q,
      in: () => { usedIn = true; return q; },
      order: () => q,
      limit: () => q,
      insert: (values) => { state.inserts.push({ table, values }); state.ops.push(`insert:${table}`); return q; },
      // filters is the LIVE array reference — .eq() calls land after .update()
      // in the chain, so the journal entry keeps filling as they arrive.
      update: (values) => { usedUpdate = true; updateValues = values; state.updates.push({ table, values, filters: eqFilters }); return q; },
      maybeSingle: async () => {
        if (table === "lead_tickets") {
          if (usedUpdate) {
            // CAS-honoring: the update applies only when every .eq() filter
            // matches the ticket AS IT STANDS NOW (like the real database).
            if (state.ticketUpdateError) return { data: null, error: state.ticketUpdateError };
            const t = state.ticket;
            if (!t || !eqFilters.every(([f, v]) => t[f] === v)) return { data: null, error: null };
            Object.assign(t, updateValues);
            return { data: { id: t.id }, error: null };
          }
          return { data: state.ticket, error: null };
        }
        if (table === "leads") return { data: state.lead, error: null };
        if (table === "site_agent_runs") return { data: usedIn ? state.activeRun : state.run, error: null };
        if (table === "app_settings") return { data: state.settings, error: null };
        return { data: null, error: null };
      },
      single: async () => {
        const error = state.insertErrorQueue.length ? state.insertErrorQueue.shift()! : state.insertError;
        return error ? { data: null, error } : { data: state.insertedRun, error: null };
      },
      then: (resolve) => {
        if (!usedUpdate && table === "site_agent_runs") return resolve({ data: state.runsList, error: null });
        if (!usedUpdate && table === "ticket_items") return resolve({ data: state.itemsList, error: null });
        return resolve({ data: null, error: null });
      },
    };
    return q;
  }
  state.client = {
    from: (table: string) => query(table),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body?: unknown) => {
          state.uploads.push({ bucket, path }); state.uploadBodies.push(body); state.ops.push("upload");
          return { error: state.uploadError };
        },
        remove: async (paths: string[]) => { state.removes.push({ bucket, paths }); state.ops.push("remove"); return { data: null, error: null }; },
      }),
    },
  };
  return state;
});
const liveMock = vi.hoisted(() => ({
  fetchLiveSiteZip: vi.fn(),
  prepareSiteZip: vi.fn(),
  isProtectedDomain: vi.fn(() => false),
}));
vi.mock("@/lib/site-studio/deploy/liveFiles", async (importOriginal) => ({
  ...(await importOriginal<object>()), // REAL siteHostFrom
  fetchLiveSiteZip: liveMock.fetchLiveSiteZip,
  prepareSiteZip: liveMock.prepareSiteZip,
}));
vi.mock("@/lib/site-studio/deploy/protected", () => ({ isProtectedDomain: liveMock.isProtectedDomain }));
// The real shrink is covered by siteAgentSiteCopy.test.ts; here it passes the
// prepared zip through unless a test says otherwise.
const copyMock = vi.hoisted(() => {
  const passthrough = async (zip: Uint8Array): Promise<SiteCopy> => ({ ok: true, zip, totalBytes: zip.length, resized: [] });
  return { passthrough, slimSiteCopy: vi.fn(passthrough) };
});
vi.mock("@/lib/site-agent/siteCopy", () => ({ slimSiteCopy: copyMock.slimSiteCopy }));
function seedSiteCopyPassthrough() {
  copyMock.slimSiteCopy.mockReset();
  copyMock.slimSiteCopy.mockImplementation(copyMock.passthrough);
}

import { POST as processPOST } from "@/app/api/site-agent/process/route";
import { agentRunAccess } from "@/lib/site-agent/access";
import { POST as createRunPOST, GET as listRunsGET } from "@/app/api/tickets/[id]/agent-runs/route";
import { POST as leadCreatePOST, GET as leadListGET } from "@/app/api/leads/[id]/agent-runs/route";
import { GET as pollGET } from "@/app/api/site-agent/runs/[id]/route";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/events";

const ENV_KEYS = ["WGE_PROCESSOR_SECRET", "AGENT_WORKER_ENABLED", "AGY_BIN"] as const;
let savedEnv: Record<string, string | undefined>;

describe("POST /api/site-agent/process", () => {
  beforeEach(() => {
    savedEnv = {};
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    processMock.mockReset();
    process.env.WGE_PROCESSOR_SECRET = "s3cret";
    process.env.AGENT_WORKER_ENABLED = "1";
    // Any real on-disk file satisfies the machine-intrinsic gate in tests.
    process.env.AGY_BIN = "package.json";
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("503s when the worker is not enabled on this instance (prod!)", async () => {
    delete process.env.AGENT_WORKER_ENABLED;
    const res = await processPOST(new Request("http://x/api/site-agent/process", { method: "POST", headers: { "x-wge-secret": "s3cret" } }));
    expect(res.status).toBe(503);
    expect(processMock).not.toHaveBeenCalled();
  });

  it("fails closed on secret problems exactly like the other processors", async () => {
    delete process.env.WGE_PROCESSOR_SECRET;
    expect((await processPOST(new Request("http://x", { method: "POST" }))).status).toBe(503);
    process.env.WGE_PROCESSOR_SECRET = "s3cret";
    expect((await processPOST(new Request("http://x", { method: "POST", headers: { "x-wge-secret": "wrong" } }))).status).toBe(401);
    expect(processMock).not.toHaveBeenCalled();
  });

  it("503s when AGY_BIN is unset or missing — the env flag alone once leaked onto prod", async () => {
    delete process.env.AGY_BIN;
    let res = await processPOST(new Request("http://x", { method: "POST", headers: { "x-wge-secret": "s3cret" } }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/AGY_BIN/);
    process.env.AGY_BIN = "Z:/definitely/not/here/agy.exe";
    res = await processPOST(new Request("http://x", { method: "POST", headers: { "x-wge-secret": "s3cret" } }));
    expect(res.status).toBe(503);
    expect(processMock).not.toHaveBeenCalled();
  });

  it("runs the single-flight engine and reports its outcome", async () => {
    processMock.mockResolvedValue({ picked: true, runId: "r1", outcome: "review" });
    const res = await processPOST(new Request("http://x", { method: "POST", headers: { "x-wge-secret": "s3cret" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ picked: true, runId: "r1" });
  });
});

describe("middleware allowlist", () => {
  it("the process route is in isPublic (a 307 here silently kills the poller)", async () => {
    const src = await import("node:fs/promises").then((fs) => fs.readFile("lib/supabase/middleware.ts", "utf8"));
    expect(src).toContain('"/api/site-agent/process"');
  });
});

describe("instrumentation poller", () => {
  it("registers the agent poller under its OWN gate, before the WGE_POLLERS_DISABLED return", async () => {
    const src = await import("node:fs/promises").then((fs) => fs.readFile("instrumentation.ts", "utf8"));
    const agentIdx = src.indexOf("AGENT_WORKER_ENABLED");
    const disabledIdx = src.indexOf('WGE_POLLERS_DISABLED === "1"');
    expect(agentIdx).toBeGreaterThan(-1);
    expect(disabledIdx).toBeGreaterThan(-1);
    expect(agentIdx).toBeLessThan(disabledIdx);
    expect(src).toContain("/api/site-agent/process");
  });
});

function accessAdmin() {
  return {
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: table === "site_agent_runs" ? accessState.run : accessState.ticket, error: null }) }) }),
    }),
  } as never;
}

describe("agentRunAccess", () => {
  beforeEach(() => {
    accessState.user = { id: "dev-1" };
    accessState.perms = new Set(["tickets.resolve"]);
    accessState.run = { id: "run-1", ticket_id: "t-1", lead_id: "lead-1", site_host: "acme.dmviral.com", status: "review", files: {}, created_by: "dev-1" };
    accessState.ticket = { id: "t-1", created_by: "sales-1", lead_id: "lead-1", assigned_to: "dev-1" };
  });

  it("admits the ticket's assignee holding tickets.resolve", async () => {
    const out = await agentRunAccess(accessAdmin(), "run-1");
    expect("run" in out && out.run.id).toBe("run-1");
  });

  it("before migration 0086 reads the run without options, and stops asking for 10 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      let migrated = false;
      const selects: boolean[] = [];
      const admin = {
        from: (table: string) => ({
          select: (cols: string) => ({ eq: () => ({ maybeSingle: async () => {
            if (table !== "site_agent_runs") return { data: accessState.ticket, error: null };
            selects.push(cols.includes("options"));
            if (cols.includes("options") && !migrated) {
              return { data: null, error: { code: "42703", message: "column site_agent_runs.options does not exist" } };
            }
            return { data: { ...accessState.run, ...(cols.includes("options") ? { options: { speed: "quick" } } : {}) }, error: null };
          } }) }),
        }),
      } as never;
      const first = await agentRunAccess(admin, "run-1");
      expect("run" in first && first.run.id).toBe("run-1");
      expect(selects).toEqual([true, false]);
      // The panel's next polls skip the doomed read.
      await agentRunAccess(admin, "run-1");
      expect(selects).toEqual([true, false, false]);
      // Once the window passes, a now-migrated database is read in full.
      migrated = true;
      vi.setSystemTime(Date.now() + 11 * 60_000);
      const later = await agentRunAccess(admin, "run-1");
      expect(selects).toEqual([true, false, false, true]);
      expect("run" in later && later.run.options).toEqual({ speed: "quick" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("401s a signed-out caller and 403s one with neither permission", async () => {
    accessState.user = null;
    const signedOut = await agentRunAccess(accessAdmin(), "run-1");
    expect("error" in signedOut && signedOut.status).toBe(401);
    accessState.user = { id: "dev-1" };
    accessState.perms = new Set(["leads.view"]);
    const noPerm = await agentRunAccess(accessAdmin(), "run-1");
    expect("error" in noPerm && noPerm.status).toBe(403);
  });

  it("403s a tickets.resolve holder who is NOT assignee/creator/agent (out of scope)", async () => {
    accessState.ticket = { ...accessState.ticket!, assigned_to: "other-dev" };
    const out = await agentRunAccess(accessAdmin(), "run-1");
    expect("error" in out && out.status).toBe(403);
  });

  it("studio.manage bypasses ticket scoping (board operators)", async () => {
    accessState.perms = new Set(["studio.manage"]);
    accessState.ticket = { ...accessState.ticket!, assigned_to: "other-dev" };
    const out = await agentRunAccess(accessAdmin(), "run-1");
    expect("run" in out).toBe(true);
  });

  it("404s a missing run", async () => {
    accessState.run = null;
    const out = await agentRunAccess(accessAdmin(), "run-1");
    expect("error" in out && out.status).toBe(404);
  });

  it("v2: a null-ticket run is a first-class ticketless run — admitted for ANY perms holder", async () => {
    // v1 kept these operator-only (a null ticket meant a purged ticket).
    // v2's ticketless lead runs share the shape, and the operator accepted
    // the loosening for purged-ticket orphans too — resolvers now act on both.
    accessState.run = { id: "run-1", ticket_id: null, lead_id: "lead-1", site_host: "h", status: "review", files: {}, created_by: null };
    accessState.perms = new Set(["tickets.resolve"]);
    const asResolver = await agentRunAccess(accessAdmin(), "run-1");
    expect("run" in asResolver).toBe(true);
    accessState.perms = new Set(["studio.manage"]);
    const asOperator = await agentRunAccess(accessAdmin(), "run-1");
    expect("run" in asOperator).toBe(true);
  });
});

// — appended by Task 8 —
const ticketCtx = (id = "t-1") => ({ params: Promise.resolve({ id }) });
const postJson = (body: unknown) =>
  new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function seedTicketCreate() {
  accessState.user = { id: "dev-1" };
  accessState.perms = new Set(["tickets.resolve"]);
  adminState.reset();
  adminState.ticket = {
    id: "t-1", status: "Assigned", lead_id: "lead-1", created_by: "sales-1", assigned_to: "dev-1",
    title: "Fix hero", lead: { website_link: "https://acme.dmviral.com", business_name: "Acme" },
  };
  liveMock.fetchLiveSiteZip.mockReset();
  liveMock.prepareSiteZip.mockReset();
  liveMock.isProtectedDomain.mockReset();
  liveMock.isProtectedDomain.mockReturnValue(false);
  // The route's staging-precedence check runs the REAL subFromWebsiteLink,
  // which needs the apex to recognise our client subdomains.
  process.env.DA_DOMAIN = "dmviral.com";
  liveMock.fetchLiveSiteZip.mockResolvedValue({ ok: true, zip: new Uint8Array([80, 75]), host: "acme.dmviral.com", source: "staging" });
  liveMock.prepareSiteZip.mockReturnValue({ ok: true, zip: new Uint8Array([80, 75, 3, 4]), files: 1 });
  seedSiteCopyPassthrough();
}

describe("POST /api/tickets/[id]/agent-runs (Send to AI)", () => {
  beforeEach(() => {
    seedTicketCreate();
  });

  it("creates a queued run bound to the lead's site, storing the original zip BEFORE the row", async () => {
    const res = await createRunPOST(new Request("http://x", { method: "POST" }), ticketCtx());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.run).toBeTruthy();
    const ins = adminState.inserts.find((i) => i.table === "site_agent_runs");
    expect(ins?.values).toMatchObject({ ticket_id: "t-1", lead_id: "lead-1", site_host: "acme.dmviral.com", created_by: "dev-1" });
    // The id is minted app-side so the zip lands under it first — the worker's
    // 20s poll must never claim a queued row whose original.zip isn't there yet.
    const runId = ins?.values.id as string;
    expect(runId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
    expect(adminState.uploads[0]).toEqual({ bucket: "agent-sites", path: `${runId}/original.zip` });
    expect(adminState.ops.indexOf("upload")).toBeGreaterThanOrEqual(0);
    expect(adminState.ops.indexOf("upload")).toBeLessThan(adminState.ops.indexOf("insert:site_agent_runs"));
    const log = adminState.inserts.find((i) => i.table === "activity_log");
    expect(log?.values).toMatchObject({ action: "site_agent.run.created" });
  });

  it("409s a ticket that is not Assigned/In Progress, before any fetch", async () => {
    adminState.ticket = { ...adminState.ticket!, status: "Open" };
    const res = await createRunPOST(new Request("http://x", { method: "POST" }), ticketCtx());
    expect(res.status).toBe(409);
    expect(adminState.inserts).toHaveLength(0);
    expect(liveMock.fetchLiveSiteZip).not.toHaveBeenCalled();
  });

  it("422s when the lead has no website link", async () => {
    adminState.ticket = { ...adminState.ticket!, lead: { website_link: null, business_name: "Acme" } };
    const res = await createRunPOST(new Request("http://x", { method: "POST" }), ticketCtx());
    expect(res.status).toBe(422);
  });

  it("403s a protected NON-staging host", async () => {
    adminState.ticket = {
      ...adminState.ticket!,
      lead: { website_link: "https://lms.sedsolutions.online", business_name: "Acme" },
    };
    liveMock.isProtectedDomain.mockReturnValue(true);
    const res = await createRunPOST(new Request("http://x", { method: "POST" }), ticketCtx());
    expect(res.status).toBe(403);
    expect(liveMock.fetchLiveSiteZip).not.toHaveBeenCalled();
  });

  it("REGRESSION: a staging subdomain is editable even though the apex is always protected", async () => {
    // The apex (DA_DOMAIN) sits permanently on the protected list, so
    // isProtectedDomain() is TRUE for every {sub}.dmviral.com — the check
    // order (staging first) is what makes client sites editable at all.
    // Shipped 403ing every staging site on 2026-09-01 before this test.
    liveMock.isProtectedDomain.mockReturnValue(true);
    const res = await createRunPOST(new Request("http://x", { method: "POST" }), ticketCtx());
    expect(res.status).toBe(201);
  });

  it("409s when a run is already in flight, before any fetch", async () => {
    adminState.activeRun = { id: "run-0", status: "queued" };
    const res = await createRunPOST(new Request("http://x", { method: "POST" }), ticketCtx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already in flight/i);
    expect(liveMock.fetchLiveSiteZip).not.toHaveBeenCalled();
  });

  it("relays a fetch failure with its status and inserts nothing", async () => {
    liveMock.fetchLiveSiteZip.mockResolvedValue({ ok: false, status: 502, error: "DA archive timed out" });
    const res = await createRunPOST(new Request("http://x", { method: "POST" }), ticketCtx());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("DA archive timed out");
    expect(adminState.inserts.find((i) => i.table === "site_agent_runs")).toBeUndefined();
  });

  it("502s on a storage failure with NO insert ever attempted — no zombie queued row", async () => {
    adminState.uploadError = { message: "disk full" };
    const res = await createRunPOST(new Request("http://x", { method: "POST" }), ticketCtx());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("disk full");
    expect(adminState.inserts).toHaveLength(0);
    expect(adminState.updates).toHaveLength(0);
  });

  it("stores the web-sized copy, not the raw live zip, and logs how many photos were resized", async () => {
    const slim = new Uint8Array([80, 75, 9, 9]);
    copyMock.slimSiteCopy.mockResolvedValue({
      ok: true, zip: slim, totalBytes: 4, resized: [{ path: "images/hero.jpg", before: 9_000_000, after: 400_000 }],
    });
    const res = await createRunPOST(new Request("http://x", { method: "POST" }), ticketCtx());
    expect(res.status).toBe(201);
    expect(copyMock.slimSiteCopy).toHaveBeenCalledWith(new Uint8Array([80, 75, 3, 4]));
    expect(adminState.uploadBodies[0]).toBe(slim);
    const log = adminState.inserts.find((i) => i.table === "activity_log");
    expect(log?.values.new_value).toMatchObject({ resized_images: 1 });
  });

  it("REGRESSION: 422s a site still too big after shrinking, naming its files — nothing uploaded or inserted", async () => {
    // insideout.dmviral.com, 2026-10-16: a 111 MB copy died at the storage
    // upload with "The object exceeded the maximum allowed size".
    copyMock.slimSiteCopy.mockResolvedValue({
      ok: false, totalBytes: 90_000_000,
      message: "The site's files add up to 85.8 MB even after shrinking its photos — Largest files: media/intro.mp4 (60.0 MB).",
    });
    const res = await createRunPOST(new Request("http://x", { method: "POST" }), ticketCtx());
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("media/intro.mp4 (60.0 MB)");
    expect(adminState.uploads).toHaveLength(0);
    expect(adminState.inserts).toHaveLength(0);
    expect(adminState.updates).toHaveLength(0);
  });

  it("409s when the row insert fails and removes the now-orphaned zip", async () => {
    // The one-active-run 409 race lands here: zip uploaded, insert refused.
    adminState.insertError = { message: "duplicate active run" };
    const res = await createRunPOST(new Request("http://x", { method: "POST" }), ticketCtx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("duplicate active run");
    const uploadedPath = adminState.uploads[0]?.path;
    expect(uploadedPath).toMatch(/\/original\.zip$/);
    expect(adminState.removes).toEqual([{ bucket: "agent-sites", paths: [uploadedPath] }]);
    // Nothing after the failed insert ran — no activity log for a run that isn't.
    expect(adminState.inserts.filter((i) => i.table === "activity_log")).toHaveLength(0);
  });

  it("403s an out-of-scope tickets.resolve caller before any fetch", async () => {
    adminState.ticket = { ...adminState.ticket!, assigned_to: "other-dev" };
    const res = await createRunPOST(new Request("http://x", { method: "POST" }), ticketCtx());
    expect(res.status).toBe(403);
    expect(liveMock.fetchLiveSiteZip).not.toHaveBeenCalled();
    expect(adminState.inserts).toHaveLength(0);
  });
});

// — appended by v2 Task 4 —
describe("POST /api/tickets/[id]/agent-runs — v2 scope/task/model intake", () => {
  beforeEach(() => {
    seedTicketCreate();
    adminState.itemsList = [
      { id: "i-1", is_done: false },
      { id: "i-2", is_done: false },
      { id: "i-3", is_done: true },
    ];
  });

  it("a plain create stores null scope/task/model — the v1 whole-ticket shape", async () => {
    const res = await createRunPOST(new Request("http://x", { method: "POST" }), ticketCtx());
    expect(res.status).toBe(201);
    const ins = adminState.inserts.find((i) => i.table === "site_agent_runs");
    expect(ins?.values).toMatchObject({ item_ids: null, task_text: null, model: null });
  });

  it("stores a proper subset of the undone items as item_ids", async () => {
    const res = await createRunPOST(postJson({ item_ids: ["i-2"] }), ticketCtx());
    expect(res.status).toBe(201);
    const ins = adminState.inserts.find((i) => i.table === "site_agent_runs");
    expect(ins?.values.item_ids).toEqual(["i-2"]);
  });

  it("normalizes ALL undone ids to null — whole-ticket has exactly one representation", async () => {
    const res = await createRunPOST(postJson({ item_ids: ["i-1", "i-2"] }), ticketCtx());
    expect(res.status).toBe(201);
    const ins = adminState.inserts.find((i) => i.table === "site_agent_runs");
    expect(ins?.values.item_ids).toBeNull();
  });

  it("422s an unknown item id, naming it, before any fetch", async () => {
    const res = await createRunPOST(postJson({ item_ids: ["i-9"] }), ticketCtx());
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("i-9");
    expect(liveMock.fetchLiveSiteZip).not.toHaveBeenCalled();
    expect(adminState.inserts).toHaveLength(0);
  });

  it("422s an already-done item id, naming it", async () => {
    const res = await createRunPOST(postJson({ item_ids: ["i-3"] }), ticketCtx());
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/i-3.+done/i);
  });

  it("422s an explicitly EMPTY selection", async () => {
    const res = await createRunPOST(postJson({ item_ids: [] }), ticketCtx());
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/at least one change/i);
    expect(liveMock.fetchLiveSiteZip).not.toHaveBeenCalled();
  });

  it("trims task_text and stores it; whitespace-only stores null", async () => {
    let res = await createRunPOST(postJson({ task_text: "  fix the hero  " }), ticketCtx());
    expect(res.status).toBe(201);
    expect(adminState.inserts.find((i) => i.table === "site_agent_runs")?.values.task_text).toBe("fix the hero");
    seedTicketCreate();
    res = await createRunPOST(postJson({ task_text: "   " }), ticketCtx());
    expect(res.status).toBe(201);
    expect(adminState.inserts.find((i) => i.table === "site_agent_runs")?.values.task_text).toBeNull();
  });

  it("422s task_text over 4000 characters", async () => {
    const res = await createRunPOST(postJson({ task_text: "x".repeat(4001) }), ticketCtx());
    expect(res.status).toBe(422);
    expect(adminState.inserts).toHaveLength(0);
  });

  it("accepts any non-empty model ≤100ch when NO list is published — the worker is the authority", async () => {
    const res = await createRunPOST(postJson({ model: "gemini-3.7" }), ticketCtx());
    expect(res.status).toBe(201);
    expect(adminState.inserts.find((i) => i.table === "site_agent_runs")?.values.model).toBe("gemini-3.7");
  });

  it("422s a model id over 100 characters even with no list", async () => {
    const res = await createRunPOST(postJson({ model: "m".repeat(101) }), ticketCtx());
    expect(res.status).toBe(422);
  });

  it("validates the model against the published list when one exists", async () => {
    adminState.settings = {
      agent_worker_models: { fetched_at: new Date().toISOString(), models: [{ id: "m-1", label: "One" }] },
    };
    let res = await createRunPOST(postJson({ model: "m-9" }), ticketCtx());
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("m-9");
    seedTicketCreate();
    adminState.settings = {
      agent_worker_models: { fetched_at: new Date().toISOString(), models: [{ id: "m-1", label: "One" }] },
    };
    res = await createRunPOST(postJson({ model: "m-1" }), ticketCtx());
    expect(res.status).toBe(201);
    expect(adminState.inserts.find((i) => i.table === "site_agent_runs")?.values.model).toBe("m-1");
  });

  it("treats an empty model string as the Antigravity default (null)", async () => {
    const res = await createRunPOST(postJson({ model: "  " }), ticketCtx());
    expect(res.status).toBe(201);
    expect(adminState.inserts.find((i) => i.table === "site_agent_runs")?.values.model).toBeNull();
  });
});

describe("POST /api/tickets/[id]/agent-runs — run controls (0086)", () => {
  const MODELS = [
    { id: "gemini-3.8-flash-low", label: "Gemini 3.8 Flash (Low)" },
    { id: "claude-sonnet-5-5-low", label: "Claude Sonnet 5.5 (Low)" },
  ];
  beforeEach(() => {
    seedTicketCreate();
  });
  const inserted = () => adminState.inserts.find((i) => i.table === "site_agent_runs")?.values;

  it("a plain create is sent with the built-in controls, written out in full", async () => {
    expect((await createRunPOST(new Request("http://x", { method: "POST" }), ticketCtx())).status).toBe(201);
    expect(inserted()?.options).toEqual({ speed: "balanced", time_limit_min: 15, retries: 3, site_map: true });
  });

  it("the team defaults fill whatever the sender didn't choose — model, controls and the standing rules", async () => {
    adminState.settings = {
      agent_worker_models: { fetched_at: new Date().toISOString(), models: MODELS },
      agent_defaults: { model: "gemini-3.8-flash-low", speed: "quick", time_limit_min: 6, retries: 1, house_rules: "No price changes." },
    };
    expect((await createRunPOST(postJson({ options: { retries: 0 } }), ticketCtx())).status).toBe(201);
    expect(inserted()).toMatchObject({
      model: "gemini-3.8-flash-low",
      options: { speed: "quick", time_limit_min: 6, retries: 0, site_map: true, house_rules: "No price changes." },
    });
    const log = adminState.inserts.find((i) => i.table === "activity_log");
    expect(log?.values.new_value).toMatchObject({ model: "gemini-3.8-flash-low", speed: "quick" });
  });

  it("an explicit null model is Antigravity's own default, team default or not", async () => {
    adminState.settings = {
      agent_worker_models: { fetched_at: new Date().toISOString(), models: MODELS },
      agent_defaults: { model: "gemini-3.8-flash-low" },
    };
    await createRunPOST(postJson({ model: null }), ticketCtx());
    expect(inserted()?.model).toBeNull();
  });

  it("a team default the worker no longer offers is skipped, not sent to fail", async () => {
    adminState.settings = {
      agent_worker_models: { fetched_at: new Date().toISOString(), models: MODELS },
      agent_defaults: { model: "gemini-3.7-flash-high" },
    };
    await createRunPOST(new Request("http://x", { method: "POST" }), ticketCtx());
    expect(inserted()?.model).toBeNull();
  });

  it("422s bad controls before any fetch", async () => {
    for (const options of [{ speed: "warp" }, { time_limit_min: 1 }, { retries: 9 }, "fast"]) {
      const res = await createRunPOST(postJson({ options }), ticketCtx());
      expect(res.status).toBe(422);
    }
    expect(liveMock.fetchLiveSiteZip).not.toHaveBeenCalled();
  });

  it("before migration 0086 the run is still created — just without its controls", async () => {
    adminState.insertErrorQueue = [
      { code: "PGRST204", message: "Could not find the 'options' column of 'site_agent_runs' in the schema cache" },
    ];
    const res = await createRunPOST(postJson({ options: { speed: "quick" } }), ticketCtx());
    expect(res.status).toBe(201);
    const runInserts = adminState.inserts.filter((i) => i.table === "site_agent_runs");
    expect(runInserts).toHaveLength(2);
    expect(runInserts[0].values).toHaveProperty("options");
    expect(runInserts[1].values).not.toHaveProperty("options");
  });

  it("a real insert failure is not retried", async () => {
    adminState.insertError = { code: "23505", message: "duplicate key" };
    const res = await createRunPOST(new Request("http://x", { method: "POST" }), ticketCtx());
    expect(res.status).toBe(409);
    expect(adminState.inserts.filter((i) => i.table === "site_agent_runs")).toHaveLength(1);
  });
});

describe("POST /api/tickets/[id]/agent-runs — F3 auto-start", () => {
  beforeEach(() => {
    seedTicketCreate();
  });

  it("an Assigned ticket auto-starts with the manual Start action's writes, stamped auto", async () => {
    const res = await createRunPOST(new Request("http://x", { method: "POST" }), ticketCtx());
    expect(res.status).toBe(201);
    // Mirror of the PATCH "start" case: same update fields on lead_tickets…
    const upd = adminState.updates.find((u) => u.table === "lead_tickets");
    expect(upd?.values).toMatchObject({ status: "In Progress" });
    expect(upd?.values.updated_at).toEqual(expect.any(String));
    expect(Object.keys(upd!.values).sort()).toEqual(["status", "updated_at"]);
    // …guarded by a status CAS: the write only lands on a still-Assigned row.
    expect(upd?.filters).toContainEqual(["status", "Assigned"]);
    expect(adminState.ticket?.status).toBe("In Progress");
    // …same activity row, plus the auto marker (nobody clicked Start).
    const started = adminState.inserts.find((i) => i.values.action === "ticket.started");
    expect(started?.values).toMatchObject({ user_id: "dev-1", entity_type: "ticket", entity_id: "t-1" });
    expect(started?.values.new_value).toEqual({ status: "In Progress", auto: true });
    // The run's own activity row still lands first — the run caused the start.
    const actions = adminState.inserts.filter((i) => i.table === "activity_log").map((i) => i.values.action);
    expect(actions).toEqual(["site_agent.run.created", "ticket.started"]);
  });

  it("leaves an In Progress ticket untouched", async () => {
    adminState.ticket = { ...adminState.ticket!, status: "In Progress" };
    const res = await createRunPOST(new Request("http://x", { method: "POST" }), ticketCtx());
    expect(res.status).toBe(201);
    expect(adminState.updates.filter((u) => u.table === "lead_tickets")).toHaveLength(0);
    expect(adminState.inserts.some((i) => i.values.action === "ticket.started")).toBe(false);
  });

  it("a failed auto-start never fails the created run (best-effort)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    adminState.ticketUpdateError = { message: "boom" };
    const res = await createRunPOST(new Request("http://x", { method: "POST" }), ticketCtx());
    expect(res.status).toBe(201);
    expect((await res.json()).run).toBeTruthy();
    expect(adminState.inserts.some((i) => i.values.action === "ticket.started")).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("CAS: a ticket resolved during the slow zip fetch is left alone — no stale flip, no activity", async () => {
    // The ticket read happens at the top of the request; fetchLiveSiteZip can
    // take a minute on a slow DA archive. A manual Resolve landing in that
    // window must win: the status CAS matches zero rows and we stamp nothing.
    liveMock.fetchLiveSiteZip.mockImplementation(async () => {
      adminState.ticket = { ...adminState.ticket!, status: "Resolved" };
      return { ok: true, zip: new Uint8Array([80, 75]), host: "acme.dmviral.com", source: "staging" };
    });
    const res = await createRunPOST(new Request("http://x", { method: "POST" }), ticketCtx());
    expect(res.status).toBe(201);
    expect(adminState.ticket?.status).toBe("Resolved");
    expect(adminState.inserts.some((i) => i.values.action === "ticket.started")).toBe(false);
  });
});

const leadCtx = (id = "lead-1") => ({ params: Promise.resolve({ id }) });

function seedLeadCreate() {
  accessState.user = { id: "dev-1" };
  accessState.perms = new Set(["tickets.resolve"]);
  adminState.reset();
  adminState.lead = { id: "lead-1", website_link: "https://acme.dmviral.com", business_name: "Acme" };
  liveMock.fetchLiveSiteZip.mockReset();
  liveMock.prepareSiteZip.mockReset();
  liveMock.isProtectedDomain.mockReset();
  liveMock.isProtectedDomain.mockReturnValue(false);
  process.env.DA_DOMAIN = "dmviral.com";
  liveMock.fetchLiveSiteZip.mockResolvedValue({ ok: true, zip: new Uint8Array([80, 75]), host: "acme.dmviral.com", source: "staging" });
  liveMock.prepareSiteZip.mockReturnValue({ ok: true, zip: new Uint8Array([80, 75, 3, 4]), files: 1 });
  seedSiteCopyPassthrough();
}

describe("POST /api/leads/[id]/agent-runs (AI edit site — ticketless)", () => {
  beforeEach(() => {
    seedLeadCreate();
  });

  it("creates a ticketless run: ticket_id null, task_text stored, zip BEFORE row, activity on the LEAD", async () => {
    const res = await leadCreatePOST(postJson({ task_text: "Change the phone number" }), leadCtx());
    expect(res.status).toBe(201);
    const ins = adminState.inserts.find((i) => i.table === "site_agent_runs");
    expect(ins?.values).toMatchObject({
      ticket_id: null, lead_id: "lead-1", site_host: "acme.dmviral.com",
      task_text: "Change the phone number", model: null, created_by: "dev-1",
    });
    const runId = ins?.values.id as string;
    expect(runId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
    expect(adminState.uploads[0]).toEqual({ bucket: "agent-sites", path: `${runId}/original.zip` });
    expect(adminState.ops.indexOf("upload")).toBeLessThan(adminState.ops.indexOf("insert:site_agent_runs"));
    const log = adminState.inserts.find((i) => i.table === "activity_log");
    expect(log?.values).toMatchObject({ action: "site_agent.run.created", entity_type: "lead", entity_id: "lead-1" });
  });

  it("422s a missing or empty task_text before any fetch — the task IS the ticket here", async () => {
    for (const req of [new Request("http://x", { method: "POST" }), postJson({}), postJson({ task_text: "   " })]) {
      const res = await leadCreatePOST(req, leadCtx());
      expect(res.status).toBe(422);
    }
    expect(liveMock.fetchLiveSiteZip).not.toHaveBeenCalled();
    expect(adminState.inserts).toHaveLength(0);
  });

  it("422s task_text over 4000 characters", async () => {
    const res = await leadCreatePOST(postJson({ task_text: "x".repeat(4001) }), leadCtx());
    expect(res.status).toBe(422);
  });

  it("stores the web-sized copy, and 422s one still too big — same guard as the ticket route", async () => {
    const slim = new Uint8Array([80, 75, 9, 9]);
    copyMock.slimSiteCopy.mockResolvedValueOnce({ ok: true, zip: slim, totalBytes: 4, resized: [] });
    let res = await leadCreatePOST(postJson({ task_text: "Swap the hero photo" }), leadCtx());
    expect(res.status).toBe(201);
    expect(adminState.uploadBodies[0]).toBe(slim);

    seedLeadCreate();
    copyMock.slimSiteCopy.mockResolvedValueOnce({ ok: false, totalBytes: 90_000_000, message: "Largest files: old-site.zip (70.0 MB)." });
    res = await leadCreatePOST(postJson({ task_text: "Swap the hero photo" }), leadCtx());
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("old-site.zip");
    expect(adminState.uploads).toHaveLength(0);
    expect(adminState.inserts).toHaveLength(0);
  });

  it("404s an unknown lead", async () => {
    adminState.lead = null;
    const res = await leadCreatePOST(postJson({ task_text: "t" }), leadCtx());
    expect(res.status).toBe(404);
  });

  it("422s a lead with no website link", async () => {
    adminState.lead = { ...adminState.lead!, website_link: null };
    const res = await leadCreatePOST(postJson({ task_text: "t" }), leadCtx());
    expect(res.status).toBe(422);
  });

  it("403s a protected NON-staging host but keeps staging editable (check-order copy)", async () => {
    adminState.lead = { ...adminState.lead!, website_link: "https://lms.sedsolutions.online" };
    liveMock.isProtectedDomain.mockReturnValue(true);
    let res = await leadCreatePOST(postJson({ task_text: "t" }), leadCtx());
    expect(res.status).toBe(403);
    expect(liveMock.fetchLiveSiteZip).not.toHaveBeenCalled();
    seedLeadCreate();
    liveMock.isProtectedDomain.mockReturnValue(true); // the apex is ALWAYS protected
    res = await leadCreatePOST(postJson({ task_text: "t" }), leadCtx());
    expect(res.status).toBe(201);
  });

  it("409s the per-lead unique-index violation with a friendly message and removes the orphan zip", async () => {
    adminState.insertError = {
      message: 'duplicate key value violates unique constraint "site_agent_runs_one_active_per_lead"',
      code: "23505",
    };
    const res = await leadCreatePOST(postJson({ task_text: "t" }), leadCtx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already in flight for this lead/i);
    const uploadedPath = adminState.uploads[0]?.path;
    expect(adminState.removes).toEqual([{ bucket: "agent-sites", paths: [uploadedPath] }]);
    expect(adminState.inserts.filter((i) => i.table === "activity_log")).toHaveLength(0);
  });

  it("validates the model against the published list (shared intake with the ticket route)", async () => {
    adminState.settings = {
      agent_worker_models: { fetched_at: new Date().toISOString(), models: [{ id: "m-1", label: "One" }] },
    };
    const res = await leadCreatePOST(postJson({ task_text: "t", model: "m-9" }), leadCtx());
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("m-9");
  });

  it("403s a caller without either permission", async () => {
    accessState.perms = new Set(["leads.view"]);
    const res = await leadCreatePOST(postJson({ task_text: "t" }), leadCtx());
    expect(res.status).toBe(403);
  });
});

describe("GET /api/leads/[id]/agent-runs (ticketless run history)", () => {
  beforeEach(() => {
    seedLeadCreate();
    adminState.runsList = [{ id: "run-7", status: "review" }];
    adminState.settings = {
      agent_worker_seen_at: new Date().toISOString(),
      agent_worker_models: { fetched_at: new Date().toISOString(), models: [{ id: "m-1", label: "One" }] },
    };
  });

  it("lists the lead's ticketless runs with worker status + models (the dialog opens pre-run)", async () => {
    const res = await leadListGET(new Request("http://x"), leadCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runs).toEqual([{ id: "run-7", status: "review" }]);
    expect(body.workerOnline).toBe(true);
    expect(body.models).toEqual([{ id: "m-1", label: "One" }]);
  });

  it("403s a caller without either permission", async () => {
    accessState.perms = new Set(["leads.view"]);
    const res = await leadListGET(new Request("http://x"), leadCtx());
    expect(res.status).toBe(403);
  });
});

describe("GET /api/tickets/[id]/agent-runs (run history)", () => {
  beforeEach(() => {
    accessState.user = { id: "dev-1" };
    accessState.perms = new Set(["tickets.resolve"]);
    adminState.reset();
    // Out of scope for dev-1: not creator, not assignee, lead not in scope.
    adminState.ticket = { id: "t-1", created_by: "sales-1", lead_id: "lead-1", assigned_to: "other-dev" };
    adminState.runsList = [{ id: "run-1", status: "review" }];
  });

  it("403s a tickets.resolve caller whose ticket is out of scope", async () => {
    const res = await listRunsGET(new Request("http://x"), ticketCtx());
    expect(res.status).toBe(403);
  });

  it("studio.manage bypasses scoping and gets the runs", async () => {
    accessState.perms = new Set(["studio.manage"]);
    const res = await listRunsGET(new Request("http://x"), ticketCtx());
    expect(res.status).toBe(200);
    expect((await res.json()).runs).toEqual([{ id: "run-1", status: "review" }]);
  });

  it("v2: ships worker status + models alongside the runs (the dialog opens pre-run)", async () => {
    accessState.perms = new Set(["studio.manage"]);
    adminState.settings = {
      agent_worker_seen_at: new Date().toISOString(),
      agent_worker_models: { fetched_at: new Date().toISOString(), models: [{ id: "m-1", label: "One" }] },
    };
    const body = await (await listRunsGET(new Request("http://x"), ticketCtx())).json();
    expect(body.workerOnline).toBe(true);
    expect(body.models).toEqual([{ id: "m-1", label: "One" }]);
  });

  it("ships the team defaults the send dialog starts from, and who may change them", async () => {
    accessState.perms = new Set(["studio.manage"]);
    adminState.settings = { agent_defaults: { speed: "quick", model: "m-1" } };
    const body = await (await listRunsGET(new Request("http://x"), ticketCtx())).json();
    expect(body.defaults).toEqual({ speed: "quick", model: "m-1" });
    expect(body.canConfigure).toBe(true);
    expect(body.settingsAvailable).toBe(true);
    expect(Array.isArray(body.stats)).toBe(true);
  });
});

describe("GET /api/site-agent/runs/[id] (panel poll)", () => {
  beforeEach(() => {
    accessState.user = { id: "dev-1" };
    accessState.perms = new Set(["tickets.resolve"]);
    adminState.reset();
    adminState.run = { id: "run-1", ticket_id: "t-1", lead_id: "lead-1", site_host: "acme.dmviral.com", status: "running", files: {}, created_by: "dev-1" };
    adminState.ticket = { id: "t-1", created_by: "sales-1", lead_id: "lead-1", assigned_to: "dev-1" };
    adminState.settings = { agent_worker_seen_at: new Date().toISOString() };
  });

  it("returns the run with workerOnline true on a fresh heartbeat", async () => {
    const res = await pollGET(new Request("http://x"), ticketCtx("run-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run.id).toBe("run-1");
    expect(body.workerOnline).toBe(true);
  });

  it("reports the worker offline once the heartbeat is stale", async () => {
    adminState.settings = { agent_worker_seen_at: new Date(Date.now() - 10 * 60_000).toISOString() };
    const res = await pollGET(new Request("http://x"), ticketCtx("run-1"));
    expect(res.status).toBe(200);
    expect((await res.json()).workerOnline).toBe(false);
  });

  it("401s a signed-out caller through the shared access gate", async () => {
    accessState.user = null;
    const res = await pollGET(new Request("http://x"), ticketCtx("run-1"));
    expect(res.status).toBe(401);
  });

  it("v2: the poll payload carries the published model list", async () => {
    adminState.settings = {
      agent_worker_seen_at: new Date().toISOString(),
      agent_worker_models: { fetched_at: new Date().toISOString(), models: [{ id: "m-1", label: "One" }, { id: "m-2", label: "Two" }] },
    };
    const body = await (await pollGET(new Request("http://x"), ticketCtx("run-1"))).json();
    expect(body.models).toEqual([{ id: "m-1", label: "One" }, { id: "m-2", label: "Two" }]);
  });

  it("v2: models is [] when nothing is published or the shape is malformed", async () => {
    adminState.settings = { agent_worker_seen_at: new Date().toISOString(), agent_worker_models: { models: "bogus" } };
    let body = await (await pollGET(new Request("http://x"), ticketCtx("run-1"))).json();
    expect(body.models).toEqual([]);
    adminState.settings = { agent_worker_seen_at: new Date().toISOString() };
    body = await (await pollGET(new Request("http://x"), ticketCtx("run-1"))).json();
    expect(body.models).toEqual([]);
  });
});

describe("notification events registry", () => {
  it("registers both site-agent events on the website bell", () => {
    const events: readonly { key: string; bell: string; availableRoles: readonly string[] }[] = NOTIFICATION_EVENTS;
    const ready = events.find((e) => e.key === "site_agent_run_ready");
    const failed = events.find((e) => e.key === "site_agent_run_failed");
    expect(ready?.bell).toBe("website");
    expect(ready?.availableRoles).toEqual(["ticket_assignee", "ticket_creator"]);
    expect(failed?.bell).toBe("website");
    expect(failed?.availableRoles).toEqual(["ticket_assignee"]);
  });
});


describe("MiniMax engine — create, recovery route, wiring", () => {
  beforeEach(() => {
    seedLeadCreate();
    mmMock.afters.length = 0;
    mmMock.run.mockClear();
    mmMock.resolve.mockClear();
  });

  it("a MiniMax send is created CLAIMED by the server (running + claim_id) and started after the response", async () => {
    const res = await leadCreatePOST(
      postJson({ task_text: "Change the phone", model: "MiniMax-M2.7", options: { engine: "minimax", minimax: { temperature: 0.3 } } }),
      leadCtx(),
    );
    expect(res.status).toBe(201);
    const ins = adminState.inserts.find((i) => i.table === "site_agent_runs");
    expect(ins?.values).toMatchObject({
      status: "running", model: "MiniMax-M2.7", options: { engine: "minimax", minimax: { temperature: 0.3 } },
    });
    const claimId = ins?.values.claim_id as string;
    expect(claimId).toMatch(/^[0-9a-f-]{36}$/);
    // The zip is still stored before the row exists.
    expect(adminState.ops.indexOf("upload")).toBeLessThan(adminState.ops.indexOf("insert:site_agent_runs"));
    expect(mmMock.run).not.toHaveBeenCalled();
    for (const cb of mmMock.afters) await cb();
    expect(mmMock.run).toHaveBeenCalledWith(ins?.values.id, claimId);
    const log = adminState.inserts.find((i) => i.table === "activity_log");
    expect(log?.values.new_value).toMatchObject({ engine: "minimax", model: "MiniMax-M2.7" });
  });

  it("an Antigravity send is unchanged: queued (no status/claim written), nothing started here", async () => {
    const res = await leadCreatePOST(postJson({ task_text: "Change the phone" }), leadCtx());
    expect(res.status).toBe(201);
    const ins = adminState.inserts.find((i) => i.table === "site_agent_runs");
    expect(ins?.values).not.toHaveProperty("status");
    expect(ins?.values).not.toHaveProperty("claim_id");
    expect(mmMock.afters).toHaveLength(0);
  });

  it("422s before fetching the site when MiniMax isn't set up", async () => {
    mmMock.resolve.mockResolvedValueOnce({ ok: false, message: "MiniMax isn't ready (no key)." } as never);
    const res = await leadCreatePOST(postJson({ task_text: "t", options: { engine: "minimax" } }), leadCtx());
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/MiniMax isn't ready/);
    expect(liveMock.fetchLiveSiteZip).not.toHaveBeenCalled();
  });

  it("the recovery route is secret-guarded, public to middleware, and polled on prod", async () => {
    const { POST } = await import("@/app/api/site-agent/minimax/process/route");
    process.env.WGE_PROCESSOR_SECRET = "s3cret";
    expect((await POST(new Request("http://x", { method: "POST" }))).status).toBe(401);
    const fs = await import("node:fs/promises");
    expect(await fs.readFile("lib/supabase/middleware.ts", "utf8")).toContain('"/api/site-agent/minimax/process"');
    const inst = await fs.readFile("instrumentation.ts", "utf8");
    // A prod poller (after the WGE_POLLERS_DISABLED return), not the worker box's.
    expect(inst.indexOf("/api/site-agent/minimax/process")).toBeGreaterThan(inst.indexOf('WGE_POLLERS_DISABLED === "1"'));
  });
});
