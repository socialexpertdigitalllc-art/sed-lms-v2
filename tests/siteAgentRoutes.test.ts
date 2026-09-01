// tests/siteAgentRoutes.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const processMock = vi.hoisted(() => vi.fn());
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
    run: null as Row, // site_agent_runs .eq().maybeSingle() (agentRunAccess path)
    activeRun: null as Row, // site_agent_runs ....in().maybeSingle() (active-run check)
    insertedRun: { id: "run-9" } as Row,
    insertError: null as { message: string } | null,
    runsList: [] as unknown[],
    settings: null as Row, // app_settings .maybeSingle()
    uploadError: null as { message: string } | null,
    inserts: [] as { table: string; values: Record<string, unknown> }[],
    updates: [] as { table: string; values: Record<string, unknown> }[],
    uploads: [] as { bucket: string; path: string }[],
    removes: [] as { bucket: string; paths: string[] }[],
    /** Interleaved op log — pins the upload-BEFORE-insert ordering. */
    ops: [] as string[],
    client: null as unknown,
    reset() {
      state.ticket = null; state.run = null; state.activeRun = null;
      state.insertedRun = { id: "run-9" }; state.insertError = null;
      state.runsList = []; state.settings = null; state.uploadError = null;
      state.inserts = []; state.updates = []; state.uploads = [];
      state.removes = []; state.ops = [];
    },
  };
  function query(table: string): Chain {
    let usedIn = false;
    let usedUpdate = false;
    const q: Chain = {
      select: () => q,
      eq: () => q,
      in: () => { usedIn = true; return q; },
      order: () => q,
      limit: () => q,
      insert: (values) => { state.inserts.push({ table, values }); state.ops.push(`insert:${table}`); return q; },
      update: (values) => { usedUpdate = true; state.updates.push({ table, values }); return q; },
      maybeSingle: async () => {
        if (table === "lead_tickets") return { data: state.ticket, error: null };
        if (table === "site_agent_runs") return { data: usedIn ? state.activeRun : state.run, error: null };
        if (table === "app_settings") return { data: state.settings, error: null };
        return { data: null, error: null };
      },
      single: async () => (state.insertError ? { data: null, error: state.insertError } : { data: state.insertedRun, error: null }),
      then: (resolve) =>
        resolve(usedUpdate || table !== "site_agent_runs" ? { data: null, error: null } : { data: state.runsList, error: null }),
    };
    return q;
  }
  state.client = {
    from: (table: string) => query(table),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => { state.uploads.push({ bucket, path }); state.ops.push("upload"); return { error: state.uploadError }; },
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

import { POST as processPOST } from "@/app/api/site-agent/process/route";
import { agentRunAccess } from "@/lib/site-agent/access";
import { POST as createRunPOST, GET as listRunsGET } from "@/app/api/tickets/[id]/agent-runs/route";
import { GET as pollGET } from "@/app/api/site-agent/runs/[id]/route";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/events";

const ENV_KEYS = ["WGE_PROCESSOR_SECRET", "AGENT_WORKER_ENABLED"] as const;
let savedEnv: Record<string, string | undefined>;

describe("POST /api/site-agent/process", () => {
  beforeEach(() => {
    savedEnv = {};
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    processMock.mockReset();
    process.env.WGE_PROCESSOR_SECRET = "s3cret";
    process.env.AGENT_WORKER_ENABLED = "1";
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

  it("a run whose ticket is gone opens for studio.manage only", async () => {
    accessState.run = { id: "run-1", ticket_id: null, lead_id: null, site_host: "h", status: "review", files: {}, created_by: null };
    accessState.perms = new Set(["tickets.resolve"]);
    const denied = await agentRunAccess(accessAdmin(), "run-1");
    expect("error" in denied && denied.status).toBe(403);
    accessState.perms = new Set(["studio.manage"]);
    const allowed = await agentRunAccess(accessAdmin(), "run-1");
    expect("run" in allowed).toBe(true);
  });
});

// — appended by Task 8 —
const ticketCtx = (id = "t-1") => ({ params: Promise.resolve({ id }) });

describe("POST /api/tickets/[id]/agent-runs (Send to AI)", () => {
  beforeEach(() => {
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
    liveMock.fetchLiveSiteZip.mockResolvedValue({ ok: true, zip: new Uint8Array([80, 75]), host: "acme.dmviral.com", source: "staging" });
    liveMock.prepareSiteZip.mockReturnValue({ ok: true, zip: new Uint8Array([80, 75, 3, 4]), files: 1 });
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

  it("403s a protected host", async () => {
    liveMock.isProtectedDomain.mockReturnValue(true);
    const res = await createRunPOST(new Request("http://x", { method: "POST" }), ticketCtx());
    expect(res.status).toBe(403);
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
