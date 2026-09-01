// tests/siteAgentRoutes.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const processMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/site-agent/worker", () => ({ processNextAgentRun: processMock }));
vi.mock("@/lib/site-agent/workspaceFs", () => ({ fsWorkspace: {} }));
vi.mock("@/lib/site-agent/agy", () => ({ runAgy: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
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

import { POST as processPOST } from "@/app/api/site-agent/process/route";
import { agentRunAccess } from "@/lib/site-agent/access";

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
