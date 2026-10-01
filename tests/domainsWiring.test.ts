// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The background sweep only runs if three things line up — and the first two
 * fail SILENTLY (a missing allowlist entry 307s the poller to /login; route
 * tests import the handler directly and can never see it):
 *   1. the auth middleware lets /api/domains/process through without a session,
 *   2. the instrumentation poller calls it,
 *   3. the route itself demands the x-wge-secret.
 */

vi.mock("@/lib/domains/processor", () => ({ processDomains: vi.fn(async () => []) }));
vi.mock("@/lib/domains/deps", () => ({ realPipelineDeps: vi.fn(() => ({})) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));

import { POST } from "@/app/api/domains/process/route";
import { classifyImport } from "@/lib/domains/import";

const KEYS = ["WGE_PROCESSOR_SECRET", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "HOSTINGER_API_TOKEN"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  Object.assign(process.env, { WGE_PROCESSOR_SECRET: "s3cret", CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a", HOSTINGER_API_TOKEN: "h" });
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("domain sweep wiring", () => {
  it("the middleware allowlists the processor path", () => {
    const src = readFileSync("lib/supabase/middleware.ts", "utf8");
    expect(src).toMatch(/path === "\/api\/domains\/process"/);
  });

  it("the instrumentation poller calls the processor", () => {
    const src = readFileSync("instrumentation.ts", "utf8");
    expect(src).toMatch(/\/api\/domains\/process/);
  });

  it("the processor refuses calls without the right secret", async () => {
    const none = await POST(new Request("http://x/api/domains/process", { method: "POST" }));
    expect(none.status).toBe(401);
    const wrong = await POST(new Request("http://x/api/domains/process", { method: "POST", headers: { "x-wge-secret": "nope" } }));
    expect(wrong.status).toBe(401);
    const right = await POST(new Request("http://x/api/domains/process", { method: "POST", headers: { "x-wge-secret": "s3cret" } }));
    expect(right.status).toBe(200);
  });
});

describe("classifyImport", () => {
  const hosted = new Map([["handmade.com", { domain: "handmade.com", username: "u447231526" } as never]]);

  it("a domain already hosted was set up by hand: connected, linked to its lead, never re-run", () => {
    // DNS is not even consulted for a hosted domain
    expect(classifyImport("HandMade.com", hosted, null, new Map([["handmade.com", "lead-9"]]))).toEqual({
      domain: "handmade.com",
      status: "connected",
      leadId: "lead-9",
      hostingUsername: "u447231526",
    });
  });

  it("a domain pointing at a server elsewhere is a live site: connected (never taken over), linked to its lead", () => {
    expect(classifyImport("elsewhere.com", hosted, "in_use", new Map([["elsewhere.com", "lead-2"]]))).toEqual({
      domain: "elsewhere.com",
      status: "connected",
      leadId: "lead-2",
      hostingUsername: null,
    });
  });

  it("a domain pointing nowhere is unassigned (linking it later starts the setup)", () => {
    expect(classifyImport("fresh.com", hosted, "free", new Map([["fresh.com", "lead-1"]]))).toMatchObject({ status: "unassigned", leadId: null });
  });

  it("unreadable DNS decides nothing — the domain waits for the next import", () => {
    expect(classifyImport("unknown.com", hosted, null, new Map())).toBeNull();
  });
});
