// tests/siteAgentRoutes.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const processMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/site-agent/worker", () => ({ processNextAgentRun: processMock }));
vi.mock("@/lib/site-agent/workspaceFs", () => ({ fsWorkspace: {} }));
vi.mock("@/lib/site-agent/agy", () => ({ runAgy: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/notifications/notify", () => ({ notify: vi.fn() }));

import { POST as processPOST } from "@/app/api/site-agent/process/route";

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
